import type { UserPresence } from "../types/socket-events.js";

const usersBySocketId = new Map<string, UserPresence>();

export const upsertUser = (socketId: string, data?: Partial<UserPresence>): UserPresence => {
  const previous = usersBySocketId.get(socketId);
  const nextValue: UserPresence = {
    socketId,
    uid: data?.uid ?? previous?.uid ?? null,
    roomId: data?.roomId ?? previous?.roomId ?? null,
    isMuted: data?.isMuted ?? previous?.isMuted ?? false,
    isVideoOff: data?.isVideoOff ?? previous?.isVideoOff ?? false,
    isScreenSharing: data?.isScreenSharing ?? previous?.isScreenSharing ?? false
  };

  usersBySocketId.set(socketId, nextValue);
  return nextValue;
};

export const removeUser = (socketId: string): UserPresence | undefined => {
  const existing = usersBySocketId.get(socketId);
  usersBySocketId.delete(socketId);
  return existing;
};

export const getUser = (socketId: string): UserPresence | undefined => usersBySocketId.get(socketId);

export const getUsersOnline = (): UserPresence[] => Array.from(usersBySocketId.values());

export const getUsersByRoom = (roomId: string): UserPresence[] =>
  getUsersOnline().filter((user) => user.roomId === roomId);

/**
 * Returns true if any OTHER socket (different socketId) with the same uid
 * is already present in the given room.
 */
export const isUidInRoom = (uid: string, roomId: string, excludeSocketId: string): boolean =>
  getUsersByRoom(roomId).some(
    (user) => user.uid === uid && user.socketId !== excludeSocketId
  );
