import type { Server, Socket } from "socket.io";
import {
  clearRoomPresence,
  getUser,
  getUsersByRoom,
  getUsersOnline,
  isUidInRoom,
  removeUser,
  upsertUser
} from "./in-memory-store.js";
import { logger } from "../utils/logger.js";
import type {
  ClientToServerEvents,
  DeleteRoomPayload,
  IceCandidatePayload,
  JoinRoomPayload,
  MediaStatusPayload,
  MessageSendPayload,
  ServerToClientEvents,
  WebRtcAnswerPayload,
  WebRtcOfferPayload
} from "../types/socket-events.js";
import { AuthenticatedSocket } from "./auth.middleware.js";
import { ChatService } from "../services/chat.service.js";

type SocketServer = Server<ClientToServerEvents, ServerToClientEvents>;
type TypedSocket = Socket<ClientToServerEvents, ServerToClientEvents>;

const emitUsersOnline = (io: SocketServer): void => {
  io.emit("usersOnline", getUsersOnline());
};

const emitRoomUsers = (io: SocketServer, roomId: string): void => {
  io.to(roomId).emit("roomUsers", getUsersByRoom(roomId));
};

const emitRoomUsersToSocket = (socket: TypedSocket, roomId: string): void => {
  socket.emit("roomUsers", getUsersByRoom(roomId));
};

/**
 * Removes a socket from a room:
 * - Leaves the Socket.IO room
 * - Sets roomId → null in presence
 * - Notifies remaining room members
 * Logs presence state before and after for debugging.
 */
const safeLeaveRoom = (socket: TypedSocket, roomId?: string): string | undefined => {
  const user = getUser(socket.id);
  const roomToLeave = roomId ?? user?.roomId ?? undefined;

  if (!roomToLeave) return undefined;

  // ── Log BEFORE ──────────────────────────────────────────────────────────
  const before = getUsersByRoom(roomToLeave);
  logger.info("[leaveRoom] Presence BEFORE leave", {
    socketId: socket.id,
    uid: user?.uid,
    room: roomToLeave,
    usersInRoom: before.map((u) => ({ socketId: u.socketId, uid: u.uid }))
  });

  socket.leave(roomToLeave);
  upsertUser(socket.id, { roomId: null, roomOwnerUid: null });
  socket.to(roomToLeave).emit("userLeft", { socketId: socket.id, roomId: roomToLeave });

  // ── Log AFTER ──────────────────────────────────────────────────────────
  const after = getUsersByRoom(roomToLeave);
  logger.info("[leaveRoom] Presence AFTER leave", {
    socketId: socket.id,
    room: roomToLeave,
    usersInRoom: after.map((u) => ({ socketId: u.socketId, uid: u.uid }))
  });

  return roomToLeave;
};

const handleJoinRoom = async (
  io: SocketServer,
  socket: AuthenticatedSocket,
  payload: JoinRoomPayload
): Promise<void> => {
  const roomId = payload.roomId?.trim();
  if (!roomId) {
    socket.emit("errorMessage", { code: "INVALID_ROOM", message: "roomId es obligatorio." });
    return;
  }

  // ── Verify room exists in Firestore ──────────────────────────────────────
  const ownerUid = await ChatService.getRoomOwnerUid(roomId);
  if (!ownerUid) {
    socket.emit("errorMessage", { code: "ROOM_NOT_FOUND", message: "La sala no existe." });
    return;
  }

  // ── Duplicate join guard: same uid already in this exact room ─────────────
  const uid = socket.data.uid;
  if (uid && isUidInRoom(uid, roomId, socket.id)) {
    logger.warn("[joinRoom] Duplicate join rejected", {
      uid,
      roomId,
      incomingSocketId: socket.id
    });
    socket.emit("errorMessage", {
      code: "ALREADY_IN_ROOM",
      message: "Ya estás conectado a esta sala desde otra pestaña."
    });
    return;
  }

  // ── Leave previous room (if any) ─────────────────────────────────────────
  const previousRoomId = safeLeaveRoom(socket);
  if (previousRoomId) {
    emitRoomUsers(io, previousRoomId);
  }

  // ── Join new room ────────────────────────────────────────────────────────
  socket.join(roomId);
  const updatedUser = upsertUser(socket.id, { roomId, roomOwnerUid: ownerUid, uid: uid ?? null });
  socket.to(roomId).emit("userJoined", updatedUser);
  emitRoomUsers(io, roomId);

  logger.info("[joinRoom] User joined room", {
    socketId: socket.id,
    uid,
    roomId,
    usersInRoom: getUsersByRoom(roomId).map((u) => ({ socketId: u.socketId, uid: u.uid }))
  });

  console.log("Sala", getUsersByRoom(roomId));
};

const handleMessageSend = async (
  io: SocketServer,
  socket: AuthenticatedSocket,
  payload: MessageSendPayload
): Promise<void> => {
  const uid = socket.data.uid;
  if (!uid) {
    socket.emit("message:error", { code: "UNAUTHORIZED", message: "Usuario no autenticado." });
    return;
  }

  const roomId = getUser(socket.id)?.roomId;
  if (!roomId) {
    socket.emit("message:error", { code: "NO_ROOM", message: "El usuario no pertenece a ninguna sala." });
    return;
  }

  const text = payload?.text?.trim();
  if (!text) {
    socket.emit("message:error", { code: "EMPTY_MESSAGE", message: "El mensaje no puede estar vacío." });
    return;
  }

  const username = socket.data.username;
  if (!username) {
    socket.emit("message:error", { code: "UNAUTHORIZED", message: "Usuario anónimo no autorizado." });
    return;
  }

  const timestamp = new Date().toISOString();

  const message = { uid, username, text, timestamp };

  // Broadcast immediately before persisting
  io.to(roomId).emit("message:new", message);

  // Persist asynchronously — does not block the broadcast
  ChatService.saveMessage(roomId, message).catch((err) => {
    logger.error("Error persisting message to Firestore:", err);
  });
};

const handleDeleteRoom = async (
  io: SocketServer,
  socket: AuthenticatedSocket,
  payload: DeleteRoomPayload
): Promise<void> => {
  const roomId = payload.roomId?.trim();
  if (!roomId) {
    socket.emit("errorMessage", { code: "INVALID_ROOM", message: "roomId es obligatorio." });
    return;
  }

  const uid = socket.data.uid;
  if (!uid) {
    socket.emit("errorMessage", { code: "UNAUTHORIZED", message: "Usuario no autenticado." });
    return;
  }

  const requesterPresence = getUser(socket.id);
  if (requesterPresence?.roomId !== roomId) {
    socket.emit("errorMessage", {
      code: "NOT_IN_ROOM",
      message: "Debes estar conectado a la sala para eliminarla."
    });
    return;
  }

  const ownerUid = requesterPresence.roomOwnerUid ?? await ChatService.getRoomOwnerUid(roomId);
  if (!ownerUid) {
    socket.emit("errorMessage", { code: "ROOM_NOT_FOUND", message: "La sala no existe." });
    return;
  }

  if (ownerUid !== uid) {
    socket.emit("errorMessage", {
      code: "FORBIDDEN",
      message: "Solo el propietario puede eliminar esta sala."
    });
    return;
  }

  const usersInRoom = getUsersByRoom(roomId);
  logger.info("[deleteRoom] Room deletion broadcast", {
    roomId,
    deletedBy: uid,
    sockets: usersInRoom.map((user) => user.socketId)
  });

  io.to(roomId).emit("roomDeleted", {
    roomId,
    deletedBy: uid,
    reason: "OWNER_DELETED_ROOM"
  });

  io.in(roomId).socketsLeave(roomId);
  clearRoomPresence(roomId);
  emitUsersOnline(io);
};

const handleMediaStatus = (io: SocketServer, socket: TypedSocket, payload: MediaStatusPayload): void => {
  const roomId = payload.roomId?.trim();
  if (!roomId) {
    socket.emit("errorMessage", { code: "INVALID_ROOM", message: "roomId es obligatorio." });
    return;
  }

  const current = getUser(socket.id);
  if (current?.roomId !== roomId) {
    socket.emit("errorMessage", {
      code: "NOT_IN_ROOM",
      message: "Debes estar conectado a la sala para cambiar tu estado de medios."
    });
    return;
  }

  const updatedUser = upsertUser(socket.id, {
    roomId,
    isMuted: payload.isMuted ?? current?.isMuted ?? false,
    isVideoOff: payload.isVideoOff ?? current?.isVideoOff ?? false,
    isScreenSharing: payload.isScreenSharing ?? current?.isScreenSharing ?? false
  });

  socket.to(roomId).emit("media:status", updatedUser);
};

const canSignalToSocket = (
  socket: TypedSocket,
  roomId: string | undefined,
  toSocketId: string | undefined
): roomId is string => {
  const normalizedRoomId = roomId?.trim();
  if (!normalizedRoomId || !toSocketId?.trim()) {
    socket.emit("errorMessage", {
      code: "INVALID_WEBRTC_SIGNAL",
      message: "roomId y toSocketId son obligatorios."
    });
    return false;
  }

  const sender = getUser(socket.id);
  const receiver = getUser(toSocketId);
  if (sender?.roomId !== normalizedRoomId || receiver?.roomId !== normalizedRoomId) {
    socket.emit("errorMessage", {
      code: "WEBRTC_SIGNAL_FORBIDDEN",
      message: "No puedes enviar senales WebRTC fuera de tu sala."
    });
    return false;
  }

  return true;
};

const handleWebRtcOffer = (
  io: SocketServer,
  socket: TypedSocket,
  payload: WebRtcOfferPayload
): void => {
  if (!canSignalToSocket(socket, payload.roomId, payload.toSocketId)) return;

  io.to(payload.toSocketId).emit("webrtc:offer", {
    fromSocketId: socket.id,
    roomId: payload.roomId.trim(),
    offer: payload.offer
  });
};

const handleWebRtcAnswer = (
  io: SocketServer,
  socket: TypedSocket,
  payload: WebRtcAnswerPayload
): void => {
  if (!canSignalToSocket(socket, payload.roomId, payload.toSocketId)) return;

  io.to(payload.toSocketId).emit("webrtc:answer", {
    fromSocketId: socket.id,
    roomId: payload.roomId.trim(),
    answer: payload.answer
  });
};

const handleIceCandidate = (
  io: SocketServer,
  socket: TypedSocket,
  payload: IceCandidatePayload
): void => {
  if (!canSignalToSocket(socket, payload.roomId, payload.toSocketId)) return;

  io.to(payload.toSocketId).emit("webrtc:ice-candidate", {
    fromSocketId: socket.id,
    roomId: payload.roomId.trim(),
    candidate: payload.candidate
  });
};

export const registerSocketHandlers = (io: SocketServer): void => {
  io.on("connection", (socket: AuthenticatedSocket) => {
    const uid = socket.data.uid;

    // Persist uid in presence from the moment of connection
    upsertUser(socket.id, {
      uid: uid ?? null,
      username: socket.data.username ?? null,
      name: socket.data.name ?? null,
      avatarUrl: socket.data.avatarUrl ?? null,
    });

    logger.info("Cliente conectado", {
      socketId: socket.id,
      uid,
      totalOnline: getUsersOnline().length
    });

    socket.on("newUser", () => {
      upsertUser(socket.id, {
        uid: uid ?? null,
        username: socket.data.username ?? null,
        name: socket.data.name ?? null,
        avatarUrl: socket.data.avatarUrl ?? null,
      });
      emitUsersOnline(io);
      console.log("Usuario nuevo:", getUser(socket.id));
    });

    socket.on("joinRoom", (payload) => handleJoinRoom(io, socket, payload));

    socket.on("deleteRoom", (payload) => {
      handleDeleteRoom(io, socket, payload).catch((err) => {
        logger.error("[deleteRoom] Unexpected error", err);
        socket.emit("errorMessage", {
          code: "DELETE_ROOM_FAILED",
          message: "No pudimos notificar la eliminacion de la sala."
        });
      });
    });

    socket.on("leaveRoom", (roomId) => {
      const leftRoom = safeLeaveRoom(socket, roomId);
      if (leftRoom) {
        emitRoomUsers(io, leftRoom);
      }
    });

    socket.on("roomMemberRemoved", (payload) => {
      const roomId = payload.roomId?.trim();
      if (!roomId) {
        socket.emit("errorMessage", { code: "INVALID_ROOM", message: "roomId es obligatorio." });
        return;
      }

      if (!uid) {
        socket.emit("errorMessage", { code: "UNAUTHORIZED", message: "Usuario no autenticado." });
        return;
      }

      io.to(roomId).emit("roomMemberRemoved", { roomId, uid });
      const leftRoom = safeLeaveRoom(socket, roomId);
      if (leftRoom) {
        emitRoomUsers(io, leftRoom);
      }
    });

    socket.on("roomUsersPrevisualization", (payload) => {
      const roomId = payload.roomId?.trim();
      if (!roomId) {
        socket.emit("errorMessage", { code: "INVALID_ROOM", message: "roomId es obligatorio." });
        return;
      }
      emitRoomUsersToSocket(socket, roomId);
    })

    socket.on("message:send", (payload) => handleMessageSend(io, socket, payload));

    socket.on("media:status", (payload) => handleMediaStatus(io, socket, payload));

    // WebRTC signalling — forward only, no presence changes
    socket.on("webrtc:offer", (payload) => handleWebRtcOffer(io, socket, payload));

    socket.on("webrtc:answer", (payload) => handleWebRtcAnswer(io, socket, payload));

    socket.on("webrtc:ice-candidate", (payload) => handleIceCandidate(io, socket, payload));

    // ── Disconnect: mirrors leaveRoom + full cleanup ──────────────────────
    socket.on("disconnect", () => {
      const user = getUser(socket.id);

      // Log BEFORE removal
      if (user?.roomId) {
        const before = getUsersByRoom(user.roomId);
        logger.info("[disconnect] Presence BEFORE cleanup", {
          socketId: socket.id,
          uid: user.uid,
          room: user.roomId,
          usersInRoom: before.map((u) => ({ socketId: u.socketId, uid: u.uid }))
        });
      }

      const removed = removeUser(socket.id);

      if (removed?.roomId) {
        socket.to(removed.roomId).emit("userLeft", {
          socketId: socket.id,
          roomId: removed.roomId
        });
        emitRoomUsers(io, removed.roomId);

        // Log AFTER removal
        const after = getUsersByRoom(removed.roomId);
        logger.info("[disconnect] Presence AFTER cleanup", {
          socketId: socket.id,
          room: removed.roomId,
          usersInRoom: after.map((u) => ({ socketId: u.socketId, uid: u.uid }))
        });
      }

      emitUsersOnline(io);
      logger.info("Cliente desconectado", {
        socketId: socket.id,
        uid: removed?.uid,
        totalOnline: getUsersOnline().length
      });
    });

    socket.on("ping", () => {
      console.log(`🏓 Ping recibido de ${uid}`);
      socket.emit("pong");
    });
  });
};
