import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  FlatList,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import { RouteProp, useRoute, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { ChatActions } from '../components/ChatActions';

interface Message {
  id: string;
  text: string;
  timestamp: Date;
  sender: 'user' | 'other';
  senderName: string;
}

interface Bounty {
  id: string;
  title: string;
  description: string;
  amount: number;
  status: 'open' | 'in_progress' | 'completed' | 'cancelled';
  createdBy: string;
  assignedTo?: string;
}

type ChatScreenRouteProp = RouteProp<{
  Chat: {
    bountyId: string;
    bountyTitle: string;
    otherUserId: string;
    otherUserName: string;
  };
}, 'Chat'>;

export const ChatScreen: React.FC = () => {
  const route = useRoute<ChatScreenRouteProp>();
  const navigation = useNavigation();
  const { bountyId, bountyTitle, otherUserId, otherUserName } = route.params;

  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [bounty, setBounty] = useState<Bounty | null>(null);
  const [showActions, setShowActions] = useState(false);

  useEffect(() => {
    loadBountyDetails();
    loadMessages();
  }, [bountyId]);

  const loadBountyDetails = async () => {
    try {
      // TODO: Replace with actual API call
      const mockBounty: Bounty = {
        id: bountyId,
        title: bountyTitle,
        description: 'Sample bounty description',
        amount: 100,
        status: 'completed', // For demo purposes
        createdBy: 'user1',
        assignedTo: otherUserId,
      };
      setBounty(mockBounty);
    } catch (error) {
      console.error('Error loading bounty details:', error);
    }
  };

  const loadMessages = async () => {
    try {
      // TODO: Replace with actual API call
      const mockMessages: Message[] = [
        {
          id: '1',
          text: 'Hi! I\'m interested in this bounty.',
          timestamp: new Date(Date.now() - 3600000),
          sender: 'other',
          senderName: otherUserName,
        },
        {
          id: '2',
          text: 'Great! Let me know if you have any questions.',
          timestamp: new Date(Date.now() - 3000000),
          sender: 'user',
          senderName: 'You',
        },
        {
          id: '3',
          text: 'I\'ve completed the task. Please review.',
          timestamp: new Date(Date.now() - 1800000),
          sender: 'other',
          senderName: otherUserName,
        },
      ];
      setMessages(mockMessages);
    } catch (error) {
      console.error('Error loading messages:', error);
    }
  };

  const sendMessage = async () => {
    if (newMessage.trim() === '') return;

    const message: Message = {
      id: Date.now().toString(),
      text: newMessage.trim(),
      timestamp: new Date(),
      sender: 'user',
      senderName: 'You',
    };

    setMessages(prev => [...prev, message]);
    setNewMessage('');

    try {
      // TODO: Send message to API
      console.log('Sending message:', message);
    } catch (error) {
      console.error('Error sending message:', error);
    }
  };

  const handleDeleteMessage = (messageId: string) => {
    Alert.alert(
      'Delete Message',
      'Are you sure you want to delete this message?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            setMessages(prev => prev.filter(msg => msg.id !== messageId));
          },
        },
      ]
    );
  };

  const handleDeleteChat = () => {
    Alert.alert(
      'Delete Chat',
      'Are you sure you want to delete this entire chat? This action cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            // TODO: Delete chat from API
            navigation.goBack();
          },
        },
      ]
    );
  };

  const renderMessage = ({ item }: { item: Message }) => {
    const isUser = item.sender === 'user';
    const canDelete = bounty?.status === 'completed';

    return (
      <View style={[
        styles.messageContainer,
        isUser ? styles.userMessage : styles.otherMessage
      ]}>
        <View style={[
          styles.messageBubble,
          isUser ? styles.userBubble : styles.otherBubble
        ]}>
          <Text style={[
            styles.messageText,
            isUser ? styles.userMessageText : styles.otherMessageText
          ]}>
            {item.text}
          </Text>
          <Text style={[
            styles.timestamp,
            isUser ? styles.userTimestamp : styles.otherTimestamp
          ]}>
            {item.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </Text>
        </View>
        {canDelete && (
          <TouchableOpacity
            style={styles.deleteButton}
            onPress={() => handleDeleteMessage(item.id)}
          >
            <Ionicons name="trash-outline" size={16} color="#FF6B6B" />
          </TouchableOpacity>
        )}
      </View>
    );
  };

  return (
    <KeyboardAvoidingView 
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
        >
          <Ionicons name="arrow-back" size={24} color="#007AFF" />
        </TouchableOpacity>
        <View style={styles.headerContent}>
          <Text style={styles.headerTitle}>{otherUserName}</Text>
          <Text style={styles.headerSubtitle}>{bountyTitle}</Text>
        </View>
        {bounty?.status === 'completed' && (
          <TouchableOpacity
            style={styles.actionsButton}
            onPress={() => setShowActions(true)}
          >
            <Ionicons name="ellipsis-vertical" size={24} color="#007AFF" />
          </TouchableOpacity>
        )}
      </View>

      {bounty?.status === 'completed' && (
        <View style={styles.completedBanner}>
          <Ionicons name="checkmark-circle" size={20} color="#4CAF50" />
          <Text style={styles.completedText}>Bounty Completed</Text>
        </View>
      )}

      <FlatList
        data={messages}
        renderItem={renderMessage}
        keyExtractor={(item) => item.id}
        style={styles.messagesList}
        contentContainerStyle={styles.messagesContent}
      />

      <View style={styles.inputContainer}>
        <TextInput
          style={styles.textInput}
          value={newMessage}
          onChangeText={setNewMessage}
          placeholder="Type a message..."
          multiline
          maxLength={500}
        />
        <TouchableOpacity
          style={[styles.sendButton, newMessage.trim() ? styles.sendButtonActive : null]}
          onPress={sendMessage}
          disabled={newMessage.trim() === ''}
        >
          <Ionicons 
            name="send" 
            size={20} 
            color={newMessage.trim() ? '#FFFFFF' : '#999999'} 
          />
        </TouchableOpacity>
      </View>

      <ChatActions
        visible={showActions}
        onClose={() => setShowActions(false)}
        onDeleteChat={handleDeleteChat}
        canDelete={bounty?.status === 'completed'}
      />
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#E0E0E0',
    backgroundColor: '#FFFFFF',
  },
  backButton: {
    marginRight: 12,
  },
  headerContent: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#000000',
  },
  headerSubtitle: {
    fontSize: 14,
    color: '#666666',
    marginTop: 2,
  },
  actionsButton: {
    padding: 4,
  },
  completedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#E8F5E8',
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  completedText: {
    marginLeft: 8,
    fontSize: 14,
    fontWeight: '500',
    color: '#4CAF50',
  },
  messagesList: {
    flex: 1,
  },
  messagesContent: {
    padding: 16,
  },
  messageContainer: {
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'flex-end',
  },
  userMessage: {
    justifyContent: 'flex-end',
  },
  otherMessage: {
    justifyContent: 'flex-start',
  },
  messageBubble: {
    maxWidth: '80%',
    padding: 12,
    borderRadius: 18,
  },
  userBubble: {
    backgroundColor: '#007AFF',
    borderBottomRightRadius: 6,
  },
  otherBubble: {
    backgroundColor: '#F0F0F0',
    borderBottomLeftRadius: 6,
  },
  messageText: {
    fontSize: 16,
  },
  userMessageText: {
    color: '#FFFFFF',
  },
  otherMessageText: {
    color: '#000000',
  },
  timestamp: {
    fontSize: 12,
    marginTop: 4,
  },
  userTimestamp: {
    color: 'rgba(255, 255, 255, 0.7)',
  },
  otherTimestamp: {
    color: '#666666',
  },
  deleteButton: {
    marginLeft: 8,
    marginBottom: 4,
    padding: 4,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: '#E0E0E0',
    backgroundColor: '#FFFFFF',
  },
  textInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#E0E0E0',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    maxHeight: 100,
    fontSize: 16,
  },
  sendButton: {
    marginLeft: 12,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#E0E0E0',
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendButtonActive: {
    backgroundColor: '#007AFF',
  },
});