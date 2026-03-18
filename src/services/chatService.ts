import axios from 'axios';

interface Message {
  id: string;
  content: string;
  sender: 'user' | 'assistant';
  timestamp: Date;
  bountyId?: string;
}

interface Chat {
  id: string;
  title: string;
  messages: Message[];
  bountyId?: string;
  bountyStatus?: 'pending' | 'active' | 'completed' | 'cancelled';
  createdAt: Date;
  updatedAt: Date;
}

interface ApiResponse<T> {
  data: T;
  success: boolean;
  message?: string;
}

class ChatService {
  private baseUrl = process.env.REACT_APP_API_BASE_URL || 'http://localhost:3001/api';

  async getChats(): Promise<Chat[]> {
    try {
      const response = await axios.get<ApiResponse<Chat[]>>(`${this.baseUrl}/chats`);
      return response.data.data;
    } catch (error) {
      console.error('Error fetching chats:', error);
      throw error;
    }
  }

  async getChatById(chatId: string): Promise<Chat> {
    try {
      const response = await axios.get<ApiResponse<Chat>>(`${this.baseUrl}/chats/${chatId}`);
      return response.data.data;
    } catch (error) {
      console.error('Error fetching chat:', error);
      throw error;
    }
  }

  async createChat(title: string, bountyId?: string): Promise<Chat> {
    try {
      const response = await axios.post<ApiResponse<Chat>>(`${this.baseUrl}/chats`, {
        title,
        bountyId
      });
      return response.data.data;
    } catch (error) {
      console.error('Error creating chat:', error);
      throw error;
    }
  }

  async sendMessage(chatId: string, content: string): Promise<Message> {
    try {
      const response = await axios.post<ApiResponse<Message>>(`${this.baseUrl}/chats/${chatId}/messages`, {
        content
      });
      return response.data.data;
    } catch (error) {
      console.error('Error sending message:', error);
      throw error;
    }
  }

  async deleteMessage(chatId: string, messageId: string): Promise<void> {
    try {
      // Check bounty completion status before deletion
      const chat = await this.getChatById(chatId);
      
      if (chat.bountyId && chat.bountyStatus !== 'completed') {
        throw new Error('Cannot delete messages while bounty is still active. Complete the bounty first.');
      }

      await axios.delete(`${this.baseUrl}/chats/${chatId}/messages/${messageId}`);
    } catch (error) {
      console.error('Error deleting message:', error);
      throw error;
    }
  }

  async deleteChat(chatId: string): Promise<void> {
    try {
      // Check bounty completion status before deletion
      const chat = await this.getChatById(chatId);
      
      if (chat.bountyId && chat.bountyStatus !== 'completed') {
        throw new Error('Cannot delete chat while bounty is still active. Complete the bounty first.');
      }

      await axios.delete(`${this.baseUrl}/chats/${chatId}`);
    } catch (error) {
      console.error('Error deleting chat:', error);
      throw error;
    }
  }

  async getBountyStatus(bountyId: string): Promise<string> {
    try {
      const response = await axios.get<ApiResponse<{ status: string }>>(`${this.baseUrl}/bounties/${bountyId}/status`);
      return response.data.data.status;
    } catch (error) {
      console.error('Error fetching bounty status:', error);
      throw error;
    }
  }

  async updateChatTitle(chatId: string, title: string): Promise<Chat> {
    try {
      const response = await axios.patch<ApiResponse<Chat>>(`${this.baseUrl}/chats/${chatId}`, {
        title
      });
      return response.data.data;
    } catch (error) {
      console.error('Error updating chat title:', error);
      throw error;
    }
  }

  async getChatsByBountyId(bountyId: string): Promise<Chat[]> {
    try {
      const response = await axios.get<ApiResponse<Chat[]>>(`${this.baseUrl}/chats?bountyId=${bountyId}`);
      return response.data.data;
    } catch (error) {
      console.error('Error fetching chats by bounty ID:', error);
      throw error;
    }
  }

  async markChatForDeletion(chatId: string): Promise<void> {
    try {
      await axios.patch(`${this.baseUrl}/chats/${chatId}/mark-for-deletion`);
    } catch (error) {
      console.error('Error marking chat for deletion:', error);
      throw error;
    }
  }

  async checkDeletionEligibility(chatId: string): Promise<boolean> {
    try {
      const chat = await this.getChatById(chatId);
      
      if (!chat.bountyId) {
        return true; // Can delete chats without associated bounties
      }

      const bountyStatus = await this.getBountyStatus(chat.bountyId);
      return bountyStatus === 'completed' || bountyStatus === 'cancelled';
    } catch (error) {
      console.error('Error checking deletion eligibility:', error);
      return false;
    }
  }
}

export default new ChatService();
export type { Chat, Message, ApiResponse };