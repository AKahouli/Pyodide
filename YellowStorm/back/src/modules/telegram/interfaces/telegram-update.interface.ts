export interface TelegramUser {
  id: number | string;
  username?: string;
  first_name?: string;
  last_name?: string;
  is_bot?: boolean;
}

export interface TelegramChat {
  id: number | string;
  type?: string;
}

export interface TelegramMessage {
  message_id?: number;
  text?: string;
  chat?: TelegramChat;
  from?: TelegramUser;
  reply_to_message?: {
    message_id?: number;
  };
}

export interface TelegramCallbackQuery {
  id: string;
  from?: TelegramUser;
  message?: TelegramMessage;
  data?: string;
}

export interface TelegramUpdate {
  update_id?: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}

export interface TelegramSendMessageResult {
  ok: boolean;
  result?: unknown;
  description?: string;
}
