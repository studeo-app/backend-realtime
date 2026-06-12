import { getFirestore } from "../config/firebase.config.js";

export interface ChatMessage {
  uid: string;
  username: string;
  text: string;
  timestamp: string;
}

/**
 * Service to handle message persistence in Firestore for the Realtime server.
 */
export class ChatService {
  static async getRoomOwnerUid(roomId: string): Promise<string | null> {
    try {
      const db = getFirestore();
      const doc = await db.collection("rooms").doc(roomId).get();
      if (!doc.exists) return null;

      const ownerUid = doc.data()?.ownerUid;
      return typeof ownerUid === "string" && ownerUid.trim() ? ownerUid : null;
    } catch (error) {
      console.error(`Error reading owner for room ${roomId} in Firestore:`, error);
      return null;
    }
  }

  /**
   * Persists a chat message in the Firestore collection rooms/{roomId}/messages.
   * Firestore auto-generates the document ID via .add().
   * @param roomId The room ID where the message belongs.
   * @param message The chat message data.
   */
  static async saveMessage(roomId: string, message: ChatMessage): Promise<void> {
    try {
      const db = getFirestore();
      await db
        .collection("rooms")
        .doc(roomId)
        .collection("messages")
        .add(message);
      console.log(`[Firestore] Message from ${message.username} persisted in room ${roomId}`);
    } catch (error) {
      console.error(`[Firestore Error] Failed to persist message in room ${roomId}:`, error);
    }
  }
}
