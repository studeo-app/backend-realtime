import type { RoomPresence, UserPresence } from "../types/socket-events.js";

const usersBySocketId = new Map<string, UserPresence>();
const rooms = new Map<string, { ownerUid: string }>();

export const upsertUser = (socketId: string, data?: Partial<UserPresence>): UserPresence => {
  const previous = usersBySocketId.get(socketId);
  const nextValue: UserPresence = {
    socketId,
    uid: data?.uid ?? previous?.uid ?? null,
    username: data?.username ?? previous?.username ?? null,
    name: data?.name ?? previous?.name ?? null,
    avatarUrl: data?.avatarUrl ?? previous?.avatarUrl ?? null,
    roomId: data?.roomId ?? previous?.roomId ?? null,
    isMuted: data?.isMuted ?? previous?.isMuted ?? false,
    isVideoOff: data?.isVideoOff ?? previous?.isVideoOff ?? false,
    isScreenSharing: data?.isScreenSharing ?? previous?.isScreenSharing ?? false
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

export const getRoomsPresence = (): RoomPresence[] =>
  Array.from(rooms.entries()).map(([roomId, room]) => ({
    ownerUid: room.ownerUid,
    countUsers: getUsersByRoom(roomId).length
  }));

export const getRoomOwnerUid = (roomId: string): string | undefined =>
  rooms.get(roomId)?.ownerUid;

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

