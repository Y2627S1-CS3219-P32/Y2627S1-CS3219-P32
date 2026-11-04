export interface ChatParticipants {
  requesterId: number;
  courierId: number | null;
}

export function canAccessChat(room: ChatParticipants, userId: number): boolean {
  return room.requesterId === userId || room.courierId === userId;
}
