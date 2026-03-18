export interface Message {
  id: string;
  chatId: string;
  senderId: string;
  content: string;
  type: 'text' | 'image' | 'file' | 'system';
  timestamp: Date;
  deletedAt?: Date;
  metadata?: {
    fileName?: string;
    fileSize?: number;
    imageUrl?: string;
    systemMessageType?: 'bounty_completed' | 'bounty_cancelled' | 'user_joined' | 'user_left';
  };
}

export interface Chat {
  id: string;
  bountyId: string;
  participants: string[];
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date;
  lastMessage?: Message;
  isActive: boolean;
  deletionScheduledAt?: Date;
  autoDeleteAfterCompletion: boolean;
}

export interface ChatParticipant {
  userId: string;
  joinedAt: Date;
  leftAt?: Date;
  role: 'creator' | 'hunter' | 'admin';
}

export interface ChatSettings {
  allowFileUploads: boolean;
  allowImages: boolean;
  maxFileSize: number;
  autoDeleteMessages: boolean;
  messageRetentionDays: number;
  deleteOnBountyCompletion: boolean;
}