export interface ChatMessage {
  id: string;
  fileId: string;
  userId: string;
  userName: string;
  content: string;
  timestamp: string; // ISO 8601
}

export interface OnlineUser {
  userId: string;
  userName: string;
  socketId: string;
}

// Socket.IO event payloads — client → server
export interface JoinRoomPayload {
  fileId: string;
  userId: string;
  userName: string;
}

export interface LeaveRoomPayload {
  fileId: string;
  userId: string;
}

export interface SendMessagePayload {
  fileId: string;
  userId: string;
  userName: string;
  content: string;
}

export interface TypingPayload {
  fileId: string;
  userId: string;
  userName: string;
}

export interface StopTypingPayload {
  fileId: string;
  userId: string;
}

// Socket.IO event payloads — server → client
export interface MessageReceivedPayload extends ChatMessage {}

export interface MessageHistoryPayload {
  messages: ChatMessage[];
}

export interface UserJoinedPayload {
  userId: string;
  userName: string;
  onlineUsers: OnlineUser[];
}

export interface UserLeftPayload {
  userId: string;
  userName: string;
  onlineUsers: OnlineUser[];
}

export interface OnlineUsersPayload {
  users: OnlineUser[];
}

export interface TypingIndicatorPayload {
  userId: string;
  userName: string;
  isTyping: boolean;
}

export interface ErrorPayload {
  message: string;
}
