import { Socket } from "socket.io";
import { getFirebaseAuth } from "../config/firebase.config.js";
import { env } from "../config/env.js";

export interface AuthenticatedSocket extends Socket {
  data: {
    uid?: string;
    email?: string;
    username?: string;
    name?: string;
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

    if (decodedToken.uid) socket.data.uid = decodedToken.uid;
    if (decodedToken.email) socket.data.email = decodedToken.email;

    // Obtener datos del perfil desde el backend principal
    try {
      const response = await fetch(`${env.backendUrl}/users/profile/basic`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`
        }
      });

      if (response.ok) {
        const profileData = (await response.json()) as {
          username?: string;
          firstName?: string;
          lastName?: string;
        };
        if (profileData && profileData.username) {
          socket.data.username = profileData.username;
          socket.data.name = `${profileData.firstName} ${profileData.lastName}`;
        }
      } else {
        console.warn(`Error al obtener perfil básico desde backend: ${response.status} ${response.statusText}`);
      }
    } catch (apiError) {
      console.error(`Error al conectar con el backend para perfil básico:`, apiError);
    }

    console.log(
      `Usuario autenticado: ${decodedToken.uid} (${decodedToken.email}) - Username: ${socket.data.username} - Name: ${socket.data.name}`,
    );
    next();
  } catch (error) {
    console.error(`Error de autenticación:`, error);
    next(new Error("Authentication error: Invalid token"));
  }
}
