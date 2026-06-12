import type { UserPresence } from "../types/socket-events.js";

const usersBySocketId = new Map<string, UserPresence>();

export const upsertUser = (socketId: string, data?: Partial<UserPresence>): UserPresence => {
  const previous = usersBySocketId.get(socketId);
  const nextValue: UserPresence = {
    socketId,
    uid: data?.uid ?? previous?.uid ?? null,
    username: data?.username ?? previous?.username ?? null,
    name: data?.name ?? previous?.name ?? null,
    avatarUrl: data?.avatarUrl ?? previous?.avatarUrl ?? null,
    roomId: data?.roomId ?? previous?.roomId ?? null,
    roomOwnerUid: data?.roomOwnerUid ?? previous?.roomOwnerUid ?? null,
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

export const clearRoomPresence = (roomId: string): UserPresence[] => {
  const updatedUsers: UserPresence[] = [];

  usersBySocketId.forEach((user, socketId) => {
    if (user.roomId !== roomId) return;

    const updatedUser = {
      ...user,
      roomId: null,
      roomOwnerUid: null,
      isMuted: false,
      isVideoOff: false,
      isScreenSharing: false
    };

    usersBySocketId.set(socketId, updatedUser);
    updatedUsers.push(updatedUser);
  });

  return updatedUsers;
};

/**
 * Returns true if any OTHER socket (different socketId) with the same uid
 * is already present in the given room.
 */
export const isUidInRoom = (uid: string, roomId: string, excludeSocketId: string): boolean =>
  getUsersByRoom(roomId).some(
    (user) => user.uid === uid && user.socketId !== excludeSocketId
  );
