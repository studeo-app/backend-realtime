import type { RoomPresence, UserPresence } from "../types/socket-events.js";

const usersBySocketId = new Map<string, UserPresence>();
const rooms = new Map<string, { ownerUid: string }>();

export const upsertUser = (socketId: string, data?: Partial<UserPresence>): UserPresence => {
  const previous = usersBySocketId.get(socketId);
  const nextValue: UserPresence = {
    socketId,
    uid: data && "uid" in data ? data.uid ?? null : previous?.uid ?? null,
    username: data && "username" in data ? data.username ?? null : previous?.username ?? null,
    name: data && "name" in data ? data.name ?? null : previous?.name ?? null,
    avatarUrl: data && "avatarUrl" in data ? data.avatarUrl ?? null : previous?.avatarUrl ?? null,
    roomId: data && "roomId" in data ? data.roomId ?? null : previous?.roomId ?? null,
    roomOwnerUid:
      data && "roomOwnerUid" in data ? data.roomOwnerUid ?? null : previous?.roomOwnerUid ?? null,
    isMuted: data && "isMuted" in data ? data.isMuted ?? false : previous?.isMuted ?? false,
    isVideoOff:
      data && "isVideoOff" in data ? data.isVideoOff ?? false : previous?.isVideoOff ?? false,
    isScreenSharing:
      data && "isScreenSharing" in data
        ? data.isScreenSharing ?? false
        : previous?.isScreenSharing ?? false
  };

  usersBySocketId.set(socketId, nextValue);
  return nextValue;
};

export const upsertRoom = (roomId: string, ownerUid: string): void => {
  rooms.set(roomId, { ownerUid });
};

export const removeUser = (socketId: string): UserPresence | undefined => {
  const existing = usersBySocketId.get(socketId);
  usersBySocketId.delete(socketId);
  if (existing?.roomId) {
    if (getUsersByRoom(existing.roomId).length === 0) {
      rooms.delete(existing.roomId);
    }
  }
  return existing;
};

export const removeRoom = (roomId: string): void => {
  rooms.delete(roomId);
};

export const userLeftRoom = (roomId: string, socketId: string): void => {
  const user = usersBySocketId.get(socketId);
  if (user && user.roomId === roomId) {
    upsertUser(socketId, { roomId: null });
  }
  if (getUsersByRoom(roomId).length === 0) {
    rooms.delete(roomId);
  }
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

export const isUidRoomOwner = (uid: string | undefined, roomId: string): boolean =>
  getRoomOwnerUid(roomId) === uid;
;

