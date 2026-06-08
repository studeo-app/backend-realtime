import { getFirestore } from "../config/firebase.config.js";

export interface ChatMessage {
  uid: string;
  username: string;
  avatarUrl?: string | null;
  text: string;
  timestamp: string;
}

/**
 * Service to handle message persistence in Firestore for the Realtime server.
 */
export class ChatService {
  /**
   * Verifies if a room exists in the Firestore database.
   * @param roomId The room ID to check.
   * @returns A promise that resolves to true if the room exists, false otherwise.
   */
  static async verifyRoomExists(roomId: string): Promise<boolean> {
    try {
      const db = getFirestore();
      const doc = await db.collection("rooms").doc(roomId).get();
      return doc.exists;
    } catch (error) {
      console.error(`Error verifying room ${roomId} existence in Firestore:`, error);
      return false;
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
