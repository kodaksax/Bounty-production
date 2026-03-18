import api from './api';

export interface ChatMessage {
  id: string;
  bountyId: string;
  senderId: string;
  senderName: string;
  senderRole: 'hunter' | 'creator';
  content: string;
  timestamp: string;
  type: 'text' | 'system';
}

export interface Chat {
  id: string;
  bountyId: string;
  hunterId: string;
  creatorId: string;
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateMessageRequest {
  bountyId: string;
  content: string;
}

export interface DeleteMessagesRequest {
  bountyId: string;
  messageIds: string[];
}

class ChatService {
  async getChatMessages(bountyId: string): Promise<ChatMessage[]> {
    const response = await api.get(`/chats/${bountyId}/messages`);
    return response.data;
  }

  async sendMessage(data: CreateMessageRequest): Promise<ChatMessage> {
    const response = await api.post('/chats/messages', data);
    return response.data;
  }

  async deleteChatMessages(data: DeleteMessagesRequest): Promise<void> {
    // Validate bounty completion status before allowing deletion
    const bountyResponse = await api.get(`/bounties/${data.bountyId}`);
    const bounty = bountyResponse.data;
    
    if (bounty.status !== 'completed') {
      throw new Error('Chat messages can only be deleted after bounty completion');
    }

    await api.delete('/chats/messages', { data });
  }

  async deleteEntireChat(bountyId: string): Promise<void> {
    // Validate bounty completion status before allowing deletion
    const bountyResponse = await api.get(`/bounties/${bountyId}`);
    const bounty = bountyResponse.data;
    
    if (bounty.status !== 'completed') {
      throw new Error('Chat can only be deleted after bounty completion');
    }

    await api.delete(`/chats/${bountyId}`);
  }

  async getChat(bountyId: string): Promise<Chat> {
    const response = await api.get(`/chats/${bountyId}`);
    return response.data;
  }

  async markMessagesAsRead(bountyId: string, messageIds: string[]): Promise<void> {
    await api.patch(`/chats/${bountyId}/read`, { messageIds });
  }
}

export default new ChatService();