import express from "express";
import { createServer } from "http";
import cors from "cors";
import dotenv from "dotenv";
import { initializeFirebase } from "./config/firebase.config";
import { SocketServer } from "./socket/socket.server";

// Cargar variables de entorno
dotenv.config();

// Inicializar Firebase Admin
initializeFirebase();
console.log("✅ Firebase Admin inicializado");

// Configurar Express
const app = express();
app.use(cors());
app.use(express.json());

// Health check endpoint
app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "studeo-realtime-backend",
    timestamp: new Date().toISOString(),
  });
});

// Crear servidor HTTP
const httpServer = createServer(app);

// Inicializar Socket.io
const socketServer = new SocketServer(httpServer);
console.log("✅ Socket.io configurado");

// Iniciar servidor
const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => {
  console.log("");
  console.log("═══════════════════════════════════════════");
  console.log("🚀 Studeo Realtime Backend");
  console.log(`📡 Servidor corriendo en puerto ${PORT}`);
  console.log(`🌐 Health check: http://localhost:${PORT}/health`);
  console.log("🔌 Socket.io listo para conexiones");
  console.log("═══════════════════════════════════════════");
  console.log("");
});

// Manejo de errores globales
process.on("unhandledRejection", (reason, promise) => {
  console.error("❌ Unhandled Rejection at:", promise, "reason:", reason);
});

process.on("uncaughtException", (error) => {
  console.error("❌ Uncaught Exception:", error);
});
