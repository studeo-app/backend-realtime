export interface UserPresence {
  socketId: string;
  uid: string | null;
  username: string | null;
  name: string | null;
  avatarUrl: string | null;
  roomId: string | null;
  roomOwnerUid: string | null;
  isMuted: boolean;
  isVideoOff: boolean;
  isScreenSharing: boolean;
}

export interface RoomPresence {
  ownerUid: string;
  countUsers: number;
}

export type SessionDescriptionPayload = Record<string, unknown>;
export type IceCandidateData = Record<string, unknown>;

export interface RoomMessage {
  id: string; // UUID del mensaje (necesario?)
  roomId: string;
  message: string;
  username: string;
  senderId: string;
  timestamp: string;
}

export interface JoinRoomPayload {
  roomId: string;
  isMuted?: boolean;
  isVideoOff?: boolean;
}

export interface DeleteRoomPayload {
  roomId: string;
}

export interface SendMessagePayload {
  message: string;
}

export interface MediaStatusPayload {
  roomId?: string;
  isMuted?: boolean;
  isVideoOff?: boolean;
  isScreenSharing?: boolean;
  hasAudioTrack?: boolean;
  hasVideoTrack?: boolean;
  audioTrackEnabled?: boolean;
  videoTrackEnabled?: boolean;
  audioTrackReadyState?: string | null;
  videoTrackReadyState?: string | null;
  mediaPermissions?: {
    microphone?: string;
    camera?: string;
  };
  mediaError?: string | null;
}

export interface WebRtcOfferPayload {
  roomId: string;
  toSocketId: string;
  offer: SessionDescriptionPayload;
}

export interface WebRtcAnswerPayload {
  roomId: string;
  toSocketId: string;
  answer: SessionDescriptionPayload;
}

export interface IceCandidatePayload {
  roomId: string;
  toSocketId: string;
  candidate: IceCandidateData;
}

export interface MessageSendPayload {
  text: string;
}

export interface MessageNewPayload {
  uid: string;
  username: string;
  text: string;
  timestamp: string;
}

export interface RoomDeletedPayload {
  roomId: string;
  deletedBy: string;
  reason: "OWNER_DELETED_ROOM";
}

export interface RoomUsersPrevisualizationPayload {
  roomId: string;
  socketId: string;
}

export interface RoomMemberRemovedPayload {
  roomId: string;
  uid: string;
}

export interface RoomReactionSendPayload {
  roomId: string;
  emoji: string;
}

export interface RoomReactionPayload {
  id: string;
  roomId: string;
  socketId: string;
  uid: string | null;
  username: string;
  emoji: string;
  createdAt: string;
}

export interface RoomCaptionSendPayload {
  roomId: string;
  text: string;
  isFinal?: boolean;
}

export interface RoomCaptionClearPayload {
  roomId: string;
}

export interface RoomCaptionPayload {
  roomId: string;
  socketId: string;
  uid: string | null;
  username: string;
  text: string;
  isFinal: boolean;
  updatedAt: string;
}

export interface ClientToServerEvents {
  newUser: () => void;
  joinRoom: (payload: JoinRoomPayload) => void;
  deleteRoom: (payload: DeleteRoomPayload) => void;
  leaveRoom: (roomId?: string) => void;
  roomMemberRemoved: (payload: { roomId: string; uid?: string }) => void;
  roomMemberMuted: (payload: { roomId: string; uid: string }) => void;
  roomUsersPrevisualization: (payload: RoomUsersPrevisualizationPayload) => void;
  "message:send": (payload: MessageSendPayload) => void;
  "media:status": (payload: MediaStatusPayload) => void;
  "reaction:send": (payload: RoomReactionSendPayload) => void;
  "caption:update": (payload: RoomCaptionSendPayload) => void;
  "caption:clear": (payload: RoomCaptionClearPayload) => void;
  "webrtc:offer": (payload: WebRtcOfferPayload) => void;
  "webrtc:answer": (payload: WebRtcAnswerPayload) => void;
  "webrtc:ice-candidate": (payload: IceCandidatePayload) => void;
  ping: () => void;
}

export interface ServerToClientEvents {
  usersOnline: (users: UserPresence[]) => void;
  roomUsers: (users: UserPresence[]) => void;
  userJoined: (user: UserPresence) => void;
  userLeft: (payload: { socketId: string; roomId: string | null }) => void;
  roomMemberRemoved: (payload: RoomMemberRemovedPayload) => void;
  roomMemberMuted: (payload: { roomId: string; uid: string }) => void;
  roomDeleted: (payload: RoomDeletedPayload) => void;
  "message:new": (message: MessageNewPayload) => void;
  "message:error": (payload: { code: string; message: string }) => void;
  errorMessage: (payload: { code: string; message: string }) => void;
  "media:status": (payload: UserPresence) => void;
  "reaction:new": (payload: RoomReactionPayload) => void;
  "caption:update": (payload: RoomCaptionPayload) => void;
  "caption:clear": (payload: Omit<RoomCaptionPayload, "text" | "isFinal">) => void;
  "webrtc:offer": (payload: {
    fromSocketId: string;
    roomId: string;
    offer: SessionDescriptionPayload;
  }) => void;
  "webrtc:answer": (payload: {
    fromSocketId: string;
    roomId: string;
    answer: SessionDescriptionPayload;
  }) => void;
  "webrtc:ice-candidate": (payload: {
    fromSocketId: string;
    roomId: string;
    candidate: IceCandidateData;
  }) => void;
  pong: () => void;
}

