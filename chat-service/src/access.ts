export interface ChatParticipants {
  requesterId: number;
  courierId: number | null;
  memberIds: readonly number[];
}

export function canAccessChat(room: ChatParticipants, userId: number): boolean {
  return room.requesterId === userId || room.courierId === userId || room.memberIds.includes(userId);
}
