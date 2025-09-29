import { z } from 'zod';

// TypeScript interfaces
export interface Conversation {
  id: string;
  bountyId?: string;
  isGroup: boolean;
  name: string;
  avatar?: string;
  lastMessage?: string;
  updatedAt?: string;
  participants?: string[]; // user IDs
  createdAt?: string;
}

export interface Message {
  id: string;
  conversationId: string;
  senderId: string;
  content: string;
  messageType: "text" | "image" | "file" | "system";
  createdAt: string;
  updatedAt?: string;
  readBy?: string[]; // user IDs who have read the message
}

// Zod schemas for validation
export const MessageTypeSchema = z.enum(["text", "image", "file", "system"]);

export const ConversationSchema = z.object({
  id: z.string(),
  bountyId: z.string().optional(),
  isGroup: z.boolean(),
  name: z.string().min(1, "Conversation name is required"),
  avatar: z.string().url().optional(),
  lastMessage: z.string().optional(),
  updatedAt: z.string().optional(),
  participants: z.array(z.string()).optional(),
  createdAt: z.string().optional(),
});

export const CreateConversationSchema = ConversationSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  lastMessage: true,
});

export const MessageSchema = z.object({
  id: z.string(),
  conversationId: z.string(),
  senderId: z.string(),
  content: z.string().min(1, "Message content cannot be empty"),
  messageType: MessageTypeSchema,
  createdAt: z.string(),
  updatedAt: z.string().optional(),
  readBy: z.array(z.string()).optional(),
});

export const CreateMessageSchema = MessageSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  readBy: true,
}).extend({
  messageType: MessageTypeSchema.optional().default("text"),
});

// Type inference from schemas
export type ConversationInput = z.infer<typeof ConversationSchema>;
export type CreateConversationInput = z.infer<typeof CreateConversationSchema>;
export type MessageInput = z.infer<typeof MessageSchema>;
export type CreateMessageInput = z.infer<typeof CreateMessageSchema>;