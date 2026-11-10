export interface ChatMessage {
  id: string;
  orderId: string;
  senderId: number;
  body: string;
  sentAt: string;
}

export interface ChatMessageCreate {
  body: string;
}
