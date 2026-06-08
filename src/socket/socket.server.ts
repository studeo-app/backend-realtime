import { Server as HttpServer } from "http";
import { Server, Socket } from "socket.io";
import { AuthenticatedSocket, authSocketMiddleware } from "./socket.middleware";

// Lista de orígenes permitidos (desarrollo, testing, producción)
const ALLOWED_ORIGINS = [
  "http://localhost:5173", // Frontend React (Vite)
  "http://localhost:3000", // Backend NestJS (si hace peticiones)
  "http://localhost:4173", // Frontend en modo preview
  "null", // Para testing con file:// (HTML local)
];

export class SocketServer {
  private io: Server;

  constructor(httpServer: HttpServer) {
    this.io = new Server(httpServer, {
      cors: {
        origin: (origin, callback) => {
          // Permitir peticiones sin origen (Postman, mobile apps, etc.)
          if (!origin) return callback(null, true);

          // Permitir si el origen está en la lista blanca
          if (ALLOWED_ORIGINS.includes(origin)) {
            return callback(null, true);
          }

          // En desarrollo, permitir cualquier origen (opcional, más permisivo)
          if (process.env.NODE_ENV !== "production") {
            console.warn(
              `⚠️  Origen no autorizado pero permitido en dev: ${origin}`,
            );
            return callback(null, true);
          }

          // En producción, rechazar orígenes no autorizados
          callback(new Error(`CORS: Origin ${origin} not allowed`));
        },
        methods: ["GET", "POST"],
        credentials: true,
      },
      pingTimeout: 60000,
      pingInterval: 25000,
    });

    this.setupMiddleware();
    this.setupEventHandlers();
  }

  private setupMiddleware(): void {
    // Aplicar middleware de autenticación a todas las conexiones
    this.io.use((socket: AuthenticatedSocket, next) =>
      authSocketMiddleware(socket, next),
    );
  }

  private setupEventHandlers(): void {
    this.io.on("connection", (socket: AuthenticatedSocket) => {
      const uid = socket.data.uid;
      console.log(`🔌 Nuevo cliente conectado: ${uid} (socket: ${socket.id})`);
      console.log(
        `📊 Total de clientes conectados: ${this.io.engine.clientsCount}`,
      );

      // ✅ CORREGIDO: Agregar tipos explícitos a los parámetros
      socket.on("disconnect", (reason: string) => {
        console.log(`🔌 Cliente desconectado: ${uid} (razón: ${reason})`);
        console.log(
          `📊 Total de clientes conectados: ${this.io.engine.clientsCount}`,
        );
      });

      socket.on("error", (error: Error) => {
        console.error(`❌ Error en socket ${uid}:`, error);
      });

      // Evento ping/pong para testing
      socket.on("ping", () => {
        console.log(`🏓 Ping recibido de ${uid}`);
        socket.emit("pong");
      });
    });
  }

  public getIO(): Server {
    return this.io;
  }
}
