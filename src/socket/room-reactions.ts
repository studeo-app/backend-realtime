const ALLOWED_ROOM_REACTIONS = new Set(["👍", "❤️", "😂", "😮", "🎉", "👏"]);
const REACTION_COOLDOWN_MS = 400;

const lastReactionAtBySocket = new Map<string, number>();

export const isAllowedRoomReaction = (emoji: string): boolean =>
  ALLOWED_ROOM_REACTIONS.has(emoji);

export const canSendRoomReaction = (socketId: string, now = Date.now()): boolean => {
  const lastReactionAt = lastReactionAtBySocket.get(socketId) ?? 0;
  if (now - lastReactionAt < REACTION_COOLDOWN_MS) return false;

  lastReactionAtBySocket.set(socketId, now);
  return true;
};

export const clearRoomReactionRateLimit = (socketId: string): void => {
  lastReactionAtBySocket.delete(socketId);
};
