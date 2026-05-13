import { MessageComponent, ConversationType } from './message.interface';

export type ShareType = 'public' | 'private';

export interface EmbeddedMessage {
  conversationType: ConversationType;
  content?: string;
  components?: MessageComponent[];
  modelId?: string;
  createdAt: Date;
}

export interface CreateShareData {
  conversationId: string;
  shareType: ShareType;
  title?: string;
  recipientEmails?: string[];
  expiresInDays?: number;
}

export interface ShareResponse {
  id: string;
  originalConversationId: string;
  sharedBy: string;
  shareType: ShareType;
  title: string;
  accessToken?: string;
  recipientEmails?: string[];
  forkedConversationIds?: string[];
  expiresAt?: string;
  viewCount: number;
  isRevoked: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PublicShareViewResponse {
  id: string;
  title: string;
  sharedBy: string;
  messages: EmbeddedMessage[];
  viewCount: number;
  createdAt: string;
}
