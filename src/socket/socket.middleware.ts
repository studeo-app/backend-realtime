import { Socket } from "socket.io";
import { getFirebaseAuth } from "../config/firebase.config";

export interface AuthenticatedSocket extends Socket {
  data: {
    uid?: string;
    email?: string;
  };
}

/**
 * Middleware que valida el token JWT de Firebase en la conexión del socket.
 * El cliente debe enviar el token en el handshake como:
 * { auth: { token: "firebase-id-token" } }
 */
export async function authSocketMiddleware(
  socket: AuthenticatedSocket,
  next: (err?: Error) => void,
): Promise<void> {
  try {
    const token = socket.handshake.auth?.token;

    if (!token) {
      console.warn(`⚠️  Conexión rechazada: Token no proporcionado`);
      return next(new Error("Authentication error: Token not provided"));
    }

    const decodedToken = await getFirebaseAuth().verifyIdToken(token);

    socket.data.uid = decodedToken.uid;
    socket.data.email = decodedToken.email;

    console.log(
      `✅ Usuario autenticado: ${decodedToken.uid} (${decodedToken.email})`,
    );
    next();
  } catch (error) {
    console.error(`❌ Error de autenticación:`, error);
    next(new Error("Authentication error: Invalid token"));
  }
}
