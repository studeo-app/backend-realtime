import type { Server, Socket } from "socket.io";
import { randomUUID } from "node:crypto";
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
  RoomReactionSendPayload,
  ServerToClientEvents,
  UserPresence,
  WebRtcAnswerPayload,
  WebRtcOfferPayload
} from "../types/socket-events.js";
import {
  canSendRoomReaction,
  clearRoomReactionRateLimit,
  isAllowedRoomReaction
} from "./room-reactions.js";
import { AuthenticatedSocket } from "./auth.middleware.js";
import { ChatService } from "../services/chat.service.js";

type SocketServer = Server<ClientToServerEvents, ServerToClientEvents>;
type TypedSocket = Socket<ClientToServerEvents, ServerToClientEvents>;

type WebRtcSignalKind = "offer" | "answer" | "ice-candidate";

const compactPresence = (user: UserPresence | undefined): Record<string, unknown> | null => {
  if (!user) return null;

  return {
    socketId: user.socketId,
    uid: user.uid,
    roomId: user.roomId,
    isMuted: user.isMuted,
    isVideoOff: user.isVideoOff,
    isScreenSharing: user.isScreenSharing
  };
};

const buildRoomMediaSnapshot = (roomId: string): Record<string, unknown>[] =>
  getUsersByRoom(roomId).map((user) => ({
    socketId: user.socketId,
    uid: user.uid,
    isMuted: user.isMuted,
    isVideoOff: user.isVideoOff,
    isScreenSharing: user.isScreenSharing
  }));

const buildMediaChangeLogEntries = (
  previous: UserPresence | undefined,
  next: UserPresence
): Record<string, unknown>[] => {
  const changes: Record<string, unknown>[] = [];
  if (!previous) return changes;

  if (previous.isMuted !== next.isMuted) {
    changes.push({
      device: "microphone",
      action: next.isMuted ? "turned_off" : "turned_on",
      previous: !previous.isMuted,
      next: !next.isMuted
    });
  }

  if (previous.isVideoOff !== next.isVideoOff) {
    changes.push({
      device: "camera",
      action: next.isVideoOff ? "turned_off" : "turned_on",
      previous: !previous.isVideoOff,
      next: !next.isVideoOff
    });
  }

  if (previous.isScreenSharing !== next.isScreenSharing) {
    changes.push({
      device: "screen",
      action: next.isScreenSharing ? "started_sharing" : "stopped_sharing",
      previous: previous.isScreenSharing,
      next: next.isScreenSharing
    });
  }

  return changes;
};

const getSessionDescriptionType = (description: Record<string, unknown>): unknown =>
  typeof description.type === "string" ? description.type : null;

const summarizeIceCandidate = (candidate: Record<string, unknown>): Record<string, unknown> => {
  const candidateLine = typeof candidate.candidate === "string" ? candidate.candidate : "";
  const protocol = candidateLine.match(/\b(udp|tcp)\b/i)?.[1]?.toLowerCase() ?? null;
  const candidateType = candidateLine.match(/ typ ([a-zA-Z0-9-]+)/)?.[1] ?? null;

  return {
    sdpMid: typeof candidate.sdpMid === "string" ? candidate.sdpMid : null,
    sdpMLineIndex: typeof candidate.sdpMLineIndex === "number" ? candidate.sdpMLineIndex : null,
    protocol,
    candidateType,
    hasCandidate: Boolean(candidateLine),
    candidateLength: candidateLine.length
  };
};

const logWebRtcSignalForwarded = (
  kind: WebRtcSignalKind,
  socket: TypedSocket,
  roomId: string,
  toSocketId: string,
  details: Record<string, unknown>
): void => {
  logger.info(`[webrtc:${kind}] Signal forwarded`, {
    roomId,
    fromSocketId: socket.id,
    toSocketId,
    senderMedia: compactPresence(getUser(socket.id)),
    receiverMedia: compactPresence(getUser(toSocketId)),
    roomMediaSnapshot: buildRoomMediaSnapshot(roomId),
    ...details
  });
};

const logWebRtcSignalRejected = (
  reason: string,
  socket: TypedSocket,
  roomId: string | undefined,
  toSocketId: string | undefined,
  details?: Record<string, unknown>
): void => {
  logger.warn("[webrtc:signal] Signal rejected", {
    reason,
    fromSocketId: socket.id,
    roomId: roomId ?? null,
    toSocketId: toSocketId ?? null,
    senderMedia: compactPresence(getUser(socket.id)),
    ...details
  });
};


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
    usersInRoom: before.map((u) => compactPresence(u))
  });

  socket.leave(roomToLeave);
  upsertUser(socket.id, { roomId: null, roomOwnerUid: null });
  socket.to(roomToLeave).emit("userLeft", { socketId: socket.id, roomId: roomToLeave });

  // ── Log AFTER ──────────────────────────────────────────────────────────
  const after = getUsersByRoom(roomToLeave);
  logger.info("[leaveRoom] Presence AFTER leave", {
    socketId: socket.id,
    room: roomToLeave,
    usersInRoom: after.map((u) => compactPresence(u))
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
      message: "Ya te encuentras en esta sala desde otra pestaña o dispositivo. No puedes unirte dos veces."
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
  const updatedUser = upsertUser(socket.id, {
    roomId,
    roomOwnerUid: ownerUid,
    uid: uid ?? null,
    isMuted: payload.isMuted ?? false,
    isVideoOff: payload.isVideoOff ?? false,
  });
  socket.to(roomId).emit("userJoined", updatedUser);
  emitRoomUsers(io, roomId);

  logger.info("[joinRoom] User joined room", {
    socketId: socket.id,
    uid,
    roomId,
    usersInRoom: buildRoomMediaSnapshot(roomId)
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
  const ownerUid = requesterPresence?.roomOwnerUid ?? await ChatService.getRoomOwnerUid(roomId);
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
  const requestedRoomId = payload.roomId?.trim();
  const current = getUser(socket.id);
  if (requestedRoomId && current?.roomId !== requestedRoomId) {
    logger.warn("[media:status] Rejected media status outside room", {
      socketId: socket.id,
      uid: current?.uid ?? null,
      requestedRoomId,
      currentRoomId: current?.roomId ?? null
    });
    socket.emit("errorMessage", {
      code: "NOT_IN_ROOM",
      message: "Debes estar conectado a la sala para cambiar tu estado de medios."
    });
    return;
  }

  const updatedUser = upsertUser(socket.id, {
    isMuted: payload.isMuted ?? current?.isMuted ?? false,
    isVideoOff: payload.isVideoOff ?? current?.isVideoOff ?? false,
    isScreenSharing: payload.isScreenSharing ?? current?.isScreenSharing ?? false
  });
  const roomId = requestedRoomId ?? updatedUser.roomId ?? undefined;

  logger.info("[media:status] User media status updated", {
    socketId: socket.id,
    uid: updatedUser.uid,
    roomId: roomId ?? null,
    previousMedia: compactPresence(current),
    nextMedia: compactPresence(updatedUser),
    clientMedia: {
      hasAudioTrack: payload.hasAudioTrack ?? null,
      hasVideoTrack: payload.hasVideoTrack ?? null,
      audioTrackEnabled: payload.audioTrackEnabled ?? null,
      videoTrackEnabled: payload.videoTrackEnabled ?? null,
      audioTrackReadyState: payload.audioTrackReadyState ?? null,
      videoTrackReadyState: payload.videoTrackReadyState ?? null,
      mediaPermissions: payload.mediaPermissions ?? null,
      mediaError: payload.mediaError ?? null
    },
    roomMediaSnapshot: roomId ? buildRoomMediaSnapshot(roomId) : []
  });

  const mediaChanges = buildMediaChangeLogEntries(current, updatedUser);
  mediaChanges.forEach((change) => {
    logger.info("[media:status:change] User toggled media device", {
      socketId: socket.id,
      uid: updatedUser.uid,
      username: updatedUser.username,
      roomId: roomId ?? null,
      ...change,
      clientMedia: {
        hasAudioTrack: payload.hasAudioTrack ?? null,
        hasVideoTrack: payload.hasVideoTrack ?? null,
        audioTrackEnabled: payload.audioTrackEnabled ?? null,
        videoTrackEnabled: payload.videoTrackEnabled ?? null,
        audioTrackReadyState: payload.audioTrackReadyState ?? null,
        videoTrackReadyState: payload.videoTrackReadyState ?? null,
        mediaPermissions: payload.mediaPermissions ?? null,
        mediaError: payload.mediaError ?? null
      }
    });
  });

  if (roomId) {
    socket.to(roomId).emit("media:status", updatedUser);
  }
};

const handleRoomReaction = (
  io: SocketServer,
  socket: TypedSocket,
  payload: RoomReactionSendPayload
): void => {
  const roomId = payload.roomId?.trim();
  const emoji = payload.emoji?.trim();
  const user = getUser(socket.id);

  if (!roomId || user?.roomId !== roomId) {
    socket.emit("errorMessage", {
      code: "REACTION_NOT_IN_ROOM",
      message: "Debes estar conectado a la sala para reaccionar."
    });
    return;
  }

  if (!emoji || !isAllowedRoomReaction(emoji)) {
    socket.emit("errorMessage", {
      code: "INVALID_REACTION",
      message: "La reaccion seleccionada no esta permitida."
    });
    return;
  }

  if (!canSendRoomReaction(socket.id)) return;

  io.to(roomId).emit("reaction:new", {
    id: randomUUID(),
    roomId,
    socketId: socket.id,
    uid: user.uid,
    username: user.username || user.name || "Usuario",
    emoji,
    createdAt: new Date().toISOString()
  });
};

/**
 * Validates whether a WebRTC signaling packet can be relayed.
 *
 * Media is not routed through this service. The browser clients establish a
 * mesh P2P call by creating one RTCPeerConnection per remote socket and using
 * Socket.IO only to exchange offer, answer and ICE candidate payloads. Once
 * ICE succeeds, audio/video/screen tracks flow directly browser-to-browser, or
 * through a TURN server when the browser cannot use a direct/STUN path.
 *
 * This guard keeps signaling scoped to a room: both sender and receiver must be
 * present in the requested room before the server forwards the packet.
 */
const canSignalToSocket = (
  socket: TypedSocket,
  roomId: string | undefined,
  toSocketId: string | undefined
): roomId is string => {
  const normalizedRoomId = roomId?.trim();
  const normalizedTargetSocketId = toSocketId?.trim();
  if (!normalizedRoomId || !normalizedTargetSocketId) {
    logWebRtcSignalRejected("missing_room_or_target", socket, normalizedRoomId, normalizedTargetSocketId);
    socket.emit("errorMessage", {
      code: "INVALID_WEBRTC_SIGNAL",
      message: "roomId y toSocketId son obligatorios."
    });
    return false;
  }

  const sender = getUser(socket.id);
  const receiver = getUser(normalizedTargetSocketId);
  if (sender?.roomId !== normalizedRoomId || receiver?.roomId !== normalizedRoomId) {
    logWebRtcSignalRejected("sender_or_receiver_not_in_room", socket, normalizedRoomId, normalizedTargetSocketId, {
      senderRoomId: sender?.roomId ?? null,
      receiverRoomId: receiver?.roomId ?? null,
      receiverMedia: compactPresence(receiver),
      roomMediaSnapshot: buildRoomMediaSnapshot(normalizedRoomId)
    });
    socket.emit("errorMessage", {
      code: "WEBRTC_SIGNAL_FORBIDDEN",
      message: "No puedes enviar senales WebRTC fuera de tu sala."
    });
    return false;
  }

  return true;
};

/**
 * Relays an SDP offer to one peer in the same room.
 *
 * The payload is intentionally opaque to the server; only room membership and
 * target socket are validated. The receiver gets the same offer plus
 * fromSocketId so it can answer the correct peer connection.
 */
const handleWebRtcOffer = (
  io: SocketServer,
  socket: TypedSocket,
  payload: WebRtcOfferPayload
): void => {
  if (!canSignalToSocket(socket, payload.roomId, payload.toSocketId)) return;

  const roomId = payload.roomId.trim();
  const toSocketId = payload.toSocketId.trim();
  logWebRtcSignalForwarded("offer", socket, roomId, toSocketId, {
    sdpType: getSessionDescriptionType(payload.offer)
  });

  io.to(toSocketId).emit("webrtc:offer", {
    fromSocketId: socket.id,
    roomId,
    offer: payload.offer
  });
};

/**
 * Relays an SDP answer to the peer that created the offer.
 *
 * Like offers, answers are not parsed or modified beyond adding fromSocketId.
 */
const handleWebRtcAnswer = (
  io: SocketServer,
  socket: TypedSocket,
  payload: WebRtcAnswerPayload
): void => {
  if (!canSignalToSocket(socket, payload.roomId, payload.toSocketId)) return;

  const roomId = payload.roomId.trim();
  const toSocketId = payload.toSocketId.trim();
  logWebRtcSignalForwarded("answer", socket, roomId, toSocketId, {
    sdpType: getSessionDescriptionType(payload.answer)
  });

  io.to(toSocketId).emit("webrtc:answer", {
    fromSocketId: socket.id,
    roomId,
    answer: payload.answer
  });
};

/**
 * Relays an ICE candidate to one peer in the same room.
 *
 * Candidates may represent host, srflx/STUN or relay/TURN routes; the server
 * only forwards them and logs a compact summary for debugging.
 */
const handleIceCandidate = (
  io: SocketServer,
  socket: TypedSocket,
  payload: IceCandidatePayload
): void => {
  if (!canSignalToSocket(socket, payload.roomId, payload.toSocketId)) return;

  const roomId = payload.roomId.trim();
  const toSocketId = payload.toSocketId.trim();
  logWebRtcSignalForwarded("ice-candidate", socket, roomId, toSocketId, {
    candidate: summarizeIceCandidate(payload.candidate)
  });

  io.to(toSocketId).emit("webrtc:ice-candidate", {
    fromSocketId: socket.id,
    roomId,
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

      const targetUid = payload.uid || uid;

      // Si el anfitrión está expulsando a otro miembro, validar permisos
      if (targetUid !== uid) {
        const requesterPresence = getUser(socket.id);
        if (!requesterPresence || requesterPresence.roomOwnerUid !== uid) {
          socket.emit("errorMessage", { code: "FORBIDDEN", message: "Solo el anfitrión puede expulsar miembros." });
          return;
        }

        // Forzar la desconexión del socket del usuario expulsado en el servidor
        const targetPresence = getUsersByRoom(roomId).find((u) => u.uid === targetUid);
        if (targetPresence) {
          const targetSocket = io.sockets.sockets.get(targetPresence.socketId) as TypedSocket | undefined;
          if (targetSocket) {
            targetSocket.leave(roomId);
            upsertUser(targetPresence.socketId, { roomId: null, roomOwnerUid: null });
            targetSocket.emit("roomMemberRemoved", { roomId, uid: targetUid });
          }
        }
      }

      io.to(roomId).emit("roomMemberRemoved", { roomId, uid: targetUid });

      if (targetUid === uid) {
        const leftRoom = safeLeaveRoom(socket, roomId);
        if (leftRoom) {
          emitRoomUsers(io, leftRoom);
        }
      } else {
        emitRoomUsers(io, roomId);
      }
    });

    socket.on("roomMemberMuted", (payload) => {
      const roomId = payload.roomId?.trim();
      if (!roomId) {
        socket.emit("errorMessage", { code: "INVALID_ROOM", message: "roomId es obligatorio." });
        return;
      }

      if (!uid) {
        socket.emit("errorMessage", { code: "UNAUTHORIZED", message: "Usuario no autenticado." });
        return;
      }

      // Validar que el emisor sea el anfitrión de la sala
      const requesterPresence = getUser(socket.id);
      if (!requesterPresence || requesterPresence.roomOwnerUid !== uid) {
        socket.emit("errorMessage", { code: "FORBIDDEN", message: "Solo el anfitrión puede silenciar miembros." });
        return;
      }

      logger.info("[roomMemberMuted] Host requested participant mute", {
        roomId,
        hostSocketId: socket.id,
        hostUid: uid,
        targetUid: payload.uid,
        roomMediaSnapshot: buildRoomMediaSnapshot(roomId)
      });

      io.to(roomId).emit("roomMemberMuted", payload);
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

    socket.on("reaction:send", (payload) => handleRoomReaction(io, socket, payload));

    // WebRTC signalling — forward only, no presence changes
    socket.on("webrtc:offer", (payload) => handleWebRtcOffer(io, socket, payload));

    socket.on("webrtc:answer", (payload) => handleWebRtcAnswer(io, socket, payload));

    socket.on("webrtc:ice-candidate", (payload) => handleIceCandidate(io, socket, payload));

    // ── Disconnect: mirrors leaveRoom + full cleanup ──────────────────────
    socket.on("disconnect", () => {
      const cleanupStartedAt = Date.now();
      clearRoomReactionRateLimit(socket.id);
      const user = getUser(socket.id);

      // Log BEFORE removal
      if (user?.roomId) {
        const before = getUsersByRoom(user.roomId);
        logger.info("[disconnect] Presence BEFORE cleanup", {
          socketId: socket.id,
          uid: user.uid,
          room: user.roomId,
          userMedia: compactPresence(user),
          usersInRoom: before.map((u) => compactPresence(u))
        });
      }

      const removed = removeUser(socket.id);

      if (removed?.roomId) {
        logger.info("[disconnect] Emitting userLeft and releasing WebRTC presence", {
          socketId: socket.id,
          uid: removed.uid,
          roomId: removed.roomId,
          userMedia: compactPresence(removed)
        });

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
          cleanupDurationMs: Date.now() - cleanupStartedAt,
          usersInRoom: after.map((u) => compactPresence(u))
        });
      }

      emitUsersOnline(io);
      logger.info("Cliente desconectado", {
        socketId: socket.id,
        uid: removed?.uid,
        cleanupDurationMs: Date.now() - cleanupStartedAt,
        totalOnline: getUsersOnline().length
      });
    });

    socket.on("ping", () => {
      console.log(`🏓 Ping recibido de ${uid}`);
      socket.emit("pong");
    });
  });
};
