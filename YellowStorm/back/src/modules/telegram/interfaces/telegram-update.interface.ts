export interface TelegramUser {
  id: number | string;
  username?: string;
}

export interface TelegramChat {
  id: number | string;
}

export interface TelegramMessage {
  message_id?: number;
  text?: string;
  chat?: TelegramChat;
  from?: TelegramUser;
}

export interface TelegramUpdate {
  update_id?: number;
  message?: TelegramMessage;
}

export interface TelegramSendMessageResult {
  ok: boolean;
  result?: unknown;
  description?: string;
}
