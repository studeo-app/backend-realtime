export interface UserPresence {
  socketId: string;
  uid: string | null;
  roomId: string | null;
  isMuted: boolean;
  isVideoOff: boolean;
  isScreenSharing: boolean;
  // GUARDA EL URL DEL AVATAR
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
}

export interface SendMessagePayload {
  message: string;
}

export interface MediaStatusPayload {
  roomId: string;
  isMuted?: boolean;
  isVideoOff?: boolean;
  isScreenSharing?: boolean;
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

export interface ClientToServerEvents {
  newUser: () => void;
  joinRoom: (payload: JoinRoomPayload) => void;
  leaveRoom: (roomId?: string) => void;
  "message:send": (payload: MessageSendPayload) => void;
  "media:status": (payload: MediaStatusPayload) => void;
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
  "message:new": (message: MessageNewPayload) => void;
  "message:error": (payload: { code: string; message: string }) => void;
  errorMessage: (payload: { code: string; message: string }) => void;
  "media:status": (payload: UserPresence) => void;
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

