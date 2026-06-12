import { createServer } from "node:http";
import { Server } from "socket.io";
import { app } from "./app.js";
import { env } from "./config/env.js";
import { registerSocketHandlers } from "./socket/register-socket-handlers.js";
import { initializeFirebase } from "./config/firebase.config.js";
import { authSocketMiddleware } from "./socket/auth.middleware.js";
import type { ClientToServerEvents, ServerToClientEvents } from "./types/socket-events.js";

// Inicializar Firebase Admin
initializeFirebase();
console.log("Firebase Admin inicializado");

const httpServer = createServer(app);

const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
  cors: {
    origin: env.cors,
    methods: ["GET", "POST"],
    credentials: true
  }
});

// Registrar middleware de autenticación de sockets
io.use(authSocketMiddleware);

registerSocketHandlers(io);

const PORT = env.port || 3001;

httpServer.listen(PORT, () => {
  console.log("");
  console.log("═══════════════════════════════════════════");
  console.log("Studeo Realtime Backend");
  console.log(`Servidor corriendo en puerto ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  console.log(`Docs:         http://localhost:${PORT}/docs`);
  console.log("Socket.io listo para conexiones");
  console.log("═══════════════════════════════════════════");
  console.log("");
});

// Manejo de errores globales
process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
});

process.on("uncaughtException", (error) => {
  console.error("Uncaught Exception:", error);
});
