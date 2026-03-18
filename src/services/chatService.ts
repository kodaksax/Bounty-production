import { db } from '../lib/firebase';
import {
  collection,
  doc,
  addDoc,
  getDocs,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  onSnapshot,
  Timestamp,
  writeBatch
} from 'firebase/firestore';
import { ChatMessage, Chat } from '../types/chat';

export const chatService = {
  // Create a new chat
  async createChat(bountyId: string, participants: string[]): Promise<string> {
    try {
      const chatRef = await addDoc(collection(db, 'chats'), {
        bountyId,
        participants,
        createdAt: Timestamp.now(),
        lastMessage: null,
        lastMessageAt: null
      });
      return chatRef.id;
    } catch (error) {
      console.error('Error creating chat:', error);
      throw error;
    }
  },

  // Send a message
  async sendMessage(chatId: string, senderId: string, content: string): Promise<void> {
    try {
      const messageRef = await addDoc(collection(db, 'messages'), {
        chatId,
        senderId,
        content,
        timestamp: Timestamp.now(),
        read: false
      });

      // Update chat with last message info
      const chatRef = doc(db, 'chats', chatId);
      await updateDoc(chatRef, {
        lastMessage: content,
        lastMessageAt: Timestamp.now()
      });
    } catch (error) {
      console.error('Error sending message:', error);
      throw error;
    }
  },

  // Get messages for a chat
  getMessages(chatId: string, callback: (messages: ChatMessage[]) => void) {
    const messagesQuery = query(
      collection(db, 'messages'),
      where('chatId', '==', chatId),
      orderBy('timestamp', 'asc')
    );

    return onSnapshot(messagesQuery, (snapshot) => {
      const messages = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
        timestamp: doc.data().timestamp?.toDate()
      })) as ChatMessage[];
      callback(messages);
    });
  },

  // Get chats for a user
  getUserChats(userId: string, callback: (chats: Chat[]) => void) {
    const chatsQuery = query(
      collection(db, 'chats'),
      where('participants', 'array-contains', userId),
      orderBy('lastMessageAt', 'desc')
    );

    return onSnapshot(chatsQuery, (snapshot) => {
      const chats = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
        createdAt: doc.data().createdAt?.toDate(),
        lastMessageAt: doc.data().lastMessageAt?.toDate()
      })) as Chat[];
      callback(chats);
    });
  },

  // Mark messages as read
  async markMessagesAsRead(chatId: string, userId: string): Promise<void> {
    try {
      const messagesQuery = query(
        collection(db, 'messages'),
        where('chatId', '==', chatId),
        where('senderId', '!=', userId),
        where('read', '==', false)
      );

      const snapshot = await getDocs(messagesQuery);
      const batch = writeBatch(db);

      snapshot.docs.forEach(doc => {
        batch.update(doc.ref, { read: true });
      });

      await batch.commit();
    } catch (error) {
      console.error('Error marking messages as read:', error);
      throw error;
    }
  },

  // Delete chat messages with proper cleanup
  async deleteChatMessages(chatId: string, deleteEntireChat: boolean = false): Promise<void> {
    try {
      const batch = writeBatch(db);

      // Get all messages for this chat
      const messagesQuery = query(
        collection(db, 'messages'),
        where('chatId', '==', chatId)
      );
      
      const messagesSnapshot = await getDocs(messagesQuery);
      
      // Delete all messages
      messagesSnapshot.docs.forEach(doc => {
        batch.delete(doc.ref);
      });

      if (deleteEntireChat) {
        // Delete the chat document itself
        const chatRef = doc(db, 'chats', chatId);
        batch.delete(chatRef);
      } else {
        // Just reset chat metadata
        const chatRef = doc(db, 'chats', chatId);
        batch.update(chatRef, {
          lastMessage: null,
          lastMessageAt: null
        });
      }

      await batch.commit();
    } catch (error) {
      console.error('Error deleting chat messages:', error);
      throw error;
    }
  },

  // Delete specific messages
  async deleteMessages(messageIds: string[], chatId: string): Promise<void> {
    try {
      const batch = writeBatch(db);

      // Delete specified messages
      messageIds.forEach(messageId => {
        const messageRef = doc(db, 'messages', messageId);
        batch.delete(messageRef);
      });

      await batch.commit();

      // Update chat's last message if necessary
      await this.updateChatLastMessage(chatId);
    } catch (error) {
      console.error('Error deleting messages:', error);
      throw error;
    }
  },

  // Helper method to update chat's last message after deletion
  async updateChatLastMessage(chatId: string): Promise<void> {
    try {
      const messagesQuery = query(
        collection(db, 'messages'),
        where('chatId', '==', chatId),
        orderBy('timestamp', 'desc')
      );

      const snapshot = await getDocs(messagesQuery);
      const chatRef = doc(db, 'chats', chatId);

      if (snapshot.empty) {
        // No messages left
        await updateDoc(chatRef, {
          lastMessage: null,
          lastMessageAt: null
        });
      } else {
        // Update with the most recent message
        const lastMessage = snapshot.docs[0].data();
        await updateDoc(chatRef, {
          lastMessage: lastMessage.content,
          lastMessageAt: lastMessage.timestamp
        });
      }
    } catch (error) {
      console.error('Error updating chat last message:', error);
      throw error;
    }
  },

  // Check if user can delete messages/chat
  async canUserDeleteChat(chatId: string, userId: string): Promise<boolean> {
    try {
      const chatRef = doc(db, 'chats', chatId);
      const chatDoc = await getDocs(query(collection(db, 'chats'), where('__name__', '==', chatId)));
      
      if (chatDoc.empty) return false;
      
      const chat = chatDoc.docs[0].data() as Chat;
      return chat.participants.includes(userId);
    } catch (error) {
      console.error('Error checking delete permissions:', error);
      return false;
    }
  }
};