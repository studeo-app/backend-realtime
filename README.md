# Backend Realtime — Studeo

Servidor de tiempo real para el **Salón de Estudio Colaborativo**, construido con **Node.js · TypeScript · Socket.IO · Express**.  
Maneja presencia de usuarios, mensajería instantánea en salas y señalización WebRTC, con autenticación mediante **Firebase Auth**.

---

## Tabla de contenidos

1. [Responsabilidades de cada backend](#responsabilidades-de-cada-backend)
2. [Arquitectura general](#arquitectura-general)
3. [Stack tecnológico](#stack-tecnológico)
4. [Estructura de carpetas](#estructura-de-carpetas)
5. [Variables de entorno](#variables-de-entorno)
6. [Autenticación](#autenticación)
7. [Endpoints HTTP](#endpoints-http)
8. [Eventos Socket.IO](#eventos-socketio)
9. [Casos edge validados](#casos-edge-validados)
10. [Persistencia en Firestore](#persistencia-en-firestore)
11. [Ejecutar en local](#ejecutar-en-local)
12. [Documentación interactiva de eventos](#documentación-interactiva-de-eventos)
13. [Despliegue en Render](#despliegue-en-render)

---

## Responsabilidades de cada backend

El proyecto tiene **dos backends independientes** que se complementan:

| Aspecto | `backend-realtime` (este) | `backend` (NestJS REST) |
|---|---|---|
| **Puerto default** | `3001` | `3000` / `3003` |
| **Framework** | Express + Socket.IO | NestJS |
| **Protocolo principal** | WebSocket (Socket.IO) | HTTP REST |
| **Autenticación** | Firebase JWT en el handshake del socket | Firebase JWT en cabecera `Authorization: Bearer` |
| **Responsabilidad principal** | Presencia en tiempo real, chat instantáneo, señalización WebRTC | CRUD de usuarios, salas, historial de mensajes |
| **Escritura de mensajes** | ✅ Directamente desde el evento `message:send` → Firestore | ❌ No escribe mensajes (solo los lee) |
| **Lectura de historial** | ❌ No expone endpoint REST de historial | ✅ `GET /api/rooms/:roomId/messages` con paginación |
| **Documentación interactiva** | `docs/socket-events.html` (este repo) | Swagger en `GET /api/docs` |
| **Estado en memoria** | `in-memory-store.ts` (presencia de sockets) | Base de datos Firestore |
| **Health check** | `GET /health` | `GET /api/health` |

> **Regla de diseño:** la escritura de mensajes ocurre **solo** en el servidor realtime (vía Socket.IO) para garantizar el broadcast inmediato antes de persistir. Los clientes **nunca** llaman a un endpoint REST para enviar mensajes.

---

## Arquitectura general

```
┌──────────────────────────────────────────────────────────────────┐
│                          CLIENTE (Browser)                        │
│                                                                  │
│  socket.io-client ──────────────────────────────────────────────►│
│  fetch /api/rooms/:id/messages ─────────────────────────────────►│
└──────────────────────────────────────────────────────────────────┘
         │ WebSocket                        │ HTTP REST
         ▼                                  ▼
┌──────────────────────┐        ┌──────────────────────────┐
│   backend-realtime   │        │       backend (NestJS)    │
│   (Socket.IO :3001)  │        │       (Express  :3003)    │
│                      │        │                           │
│  authMiddleware      │        │  FirebaseAuthGuard        │
│  registerHandlers    │        │  RoomsMessagesController  │
│  in-memory-store     │        │  ChatService (Firestore)  │
│  ChatService ────────┼──────► │                           │
└──────────┬───────────┘        └──────────────────────────┘
           │ Firestore Admin SDK (ambos)
           ▼
┌──────────────────────────────────┐
│          Firestore               │
│  rooms/{roomId}                  │
│  rooms/{roomId}/messages/{msgId} │
└──────────────────────────────────┘
```

### Flujo de un mensaje de chat

```
Cliente A                  backend-realtime               Firestore
   │                              │                           │
   │── message:send { text } ────►│                           │
   │                              │── io.to(room).emit ──────►│ (broadcast inmediato)
   │◄─────── message:new ─────────│                           │
   │                   Cliente B ◄┘                           │
   │                              │── saveMessage() ─────────►│ (async, no bloquea)
   │                              │                           │
```

---

## Stack tecnológico

| Paquete | Versión | Uso |
|---|---|---|
| `express` | ^4 | Servidor HTTP base + endpoints de salud |
| `socket.io` | ^4.7 | Canal WebSocket tipado |
| `firebase-admin` | ^12 | Verificación de tokens JWT + Firestore |
| `cors` | ^2 | CORS configurable por variable de entorno |
| `dotenv` | ^16 | Carga de variables de entorno |
| `tsx` | ^4 | Ejecución y recarga en desarrollo |
| `typescript` | ^5 | Tipado estático |

---

## Estructura de carpetas

```text
backend-realtime/
├── src/
│   ├── config/
│   │   ├── env.ts               # Centraliza lectura de process.env
│   │   └── firebase.config.ts   # Inicializa Firebase Admin SDK
│   ├── services/
│   │   └── chat.service.ts      # verifyRoomExists · saveMessage → Firestore
│   ├── socket/
│   │   ├── auth.middleware.ts   # io.use() — verifica JWT de Firebase en handshake
│   │   ├── in-memory-store.ts   # Mapa de presencia en memoria (Map<socketId, UserPresence>)
│   │   └── register-socket-handlers.ts  # Todos los handlers de eventos
│   ├── types/
│   │   └── socket-events.ts     # Interfaces TypeScript de todos los eventos (C→S y S→C)
│   ├── utils/
│   │   └── logger.ts            # Logger estructurado JSON (info · warn · error)
│   ├── app.ts                   # Express app (CORS, /health, /)
│   └── index.ts                 # Entrada: HTTP server + Socket.IO + bootstrap
├── docs/
│   ├── ARCHITECTURE.md          # Decisiones de arquitectura
│   └── socket-events.html       # Documentación interactiva de eventos Socket.IO
├── test-socket.html             # Cliente de prueba manual (no para producción)
├── .env.example
├── package.json
└── tsconfig.json
```

---

## Variables de entorno

Copia `.env.example` como `.env` antes de ejecutar:

```env
# Puerto del servidor (default: 3001)
PORT=3001

# Orígenes CORS permitidos, separados por coma
CORS_ORIGIN=http://localhost:5173,http://localhost:3002

# URL base del backend NestJS (para obtener perfil de usuario en el handshake)
BACKEND_URL=http://localhost:3000

# Credenciales de Firebase Admin (Service Account)
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_CLIENT_EMAIL=firebase-adminsdk@your-project.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
```

---

## Autenticación

### ¿Cuándo se usa el token?

**Siempre**, en **cada conexión** de Socket.IO.

El token de Firebase ID Token (JWT) debe enviarse en el objeto `auth` del handshake:

```js
// Cliente
const socket = io("http://localhost:3001", {
  auth: {
    token: await firebase.auth().currentUser.getIdToken()
  }
});
```

### ¿Qué verifica el middleware?

`authSocketMiddleware` (`src/socket/auth.middleware.ts`) ejecuta **antes** de que cualquier evento sea procesado:

1. Extrae `socket.handshake.auth.token`.
2. Llama a `firebase.auth().verifyIdToken(token)` — valida firma, expiración y proyecto.
3. Si es válido, enriquece `socket.data` con:
   - `socket.data.uid` — Firebase UID del usuario.
   - `socket.data.email` — correo del usuario.
   - `socket.data.username` — username del perfil (obtenido del backend NestJS).
   - `socket.data.name` — nombre completo.
4. Si falla, emite `Authentication error` y rechaza la conexión (el socket no se establece).

> **Si el token no se envía o está expirado, la conexión es rechazada.** No existe ningún socket sin autenticar en el servidor.

---

## Endpoints HTTP

> Estos endpoints son **solo para infraestructura**. La comunicación de negocio ocurre por Socket.IO.

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| `GET` | `/` | No | Información básica del servicio |
| `GET` | `/health` | No | Estado del servidor (uptime, timestamp) |

### `GET /health` — Respuesta

```json
{
  "status": "ok",
  "uptimeSeconds": 3612.5,
  "timestamp": "2026-06-07T23:00:00.000Z"
}
```

---

## Eventos Socket.IO

> Ver también [`docs/socket-events.html`](./docs/socket-events.html) para la documentación interactiva.

### Cliente → Servidor

#### `newUser`
Registra la presencia global del usuario y notifica a todos los conectados.

```ts
socket.emit("newUser")
// No recibe payload. El username y uid se obtienen de socket.data (token).
```

**Emite:** `usersOnline` → todos los sockets.

---

#### `joinRoom`
Une al socket a una sala específica. Verifica existencia en Firestore y previene uniones duplicadas desde el mismo uid.

```ts
socket.emit("joinRoom", { roomId: "abc123" })
```

| Campo | Tipo | Requerido | Descripción |
|---|---|---|---|
| `roomId` | `string` | ✅ | ID de la sala a unirse |

**Emite en éxito:**
- `userJoined` → otros miembros de la sala.
- `roomUsers` → todos en la sala (lista actualizada).

**Emite en error:**
- `errorMessage { code: "INVALID_ROOM" }` — roomId vacío.
- `errorMessage { code: "ROOM_NOT_FOUND" }` — sala no existe en Firestore.
- `errorMessage { code: "ALREADY_IN_ROOM" }` — mismo uid ya está en esa sala desde otro socket.

---

#### `leaveRoom`
Sale de la sala actual. Si no se pasa `roomId`, usa la sala activa del socket.

```ts
socket.emit("leaveRoom")
// o con roomId explícito:
socket.emit("leaveRoom", "abc123")
```

**Emite:**
- `userLeft { socketId, roomId }` → otros miembros.
- `roomUsers` → sala (lista actualizada).

---

#### `message:send`
Envía un mensaje de texto a la sala activa del socket. **No incluye roomId en el payload** — se obtiene del estado del socket en memoria.

```ts
socket.emit("message:send", { text: "Hola a todos" })
```

| Campo | Tipo | Requerido | Descripción |
|---|---|---|---|
| `text` | `string` | ✅ | Texto del mensaje (no puede ser vacío ni solo espacios) |

**Flujo:**
1. Broadcast inmediato `message:new` a toda la sala.
2. Persistencia asíncrona en Firestore (no bloquea el broadcast).

**Emite en éxito:**
- `message:new { uid, username, text, timestamp }` → toda la sala.

**Emite en error:**
- `message:error { code: "UNAUTHORIZED" }` — socket sin uid o sin username.
- `message:error { code: "NO_ROOM" }` — socket no está en ninguna sala.
- `message:error { code: "EMPTY_MESSAGE" }` — texto vacío o solo espacios.

---

#### `media:status`
Actualiza el estado de audio/video/pantalla del usuario en su sala.

```ts
socket.emit("media:status", {
  roomId: "abc123",
  isMuted: true,
  isVideoOff: false,
  isScreenSharing: false
})
```

| Campo | Tipo | Requerido | Descripción |
|---|---|---|---|
| `roomId` | `string` | ✅ | Sala donde reportar el estado |
| `isMuted` | `boolean` | ❌ | Micrófono silenciado |
| `isVideoOff` | `boolean` | ❌ | Cámara apagada |
| `isScreenSharing` | `boolean` | ❌ | Compartiendo pantalla |

**Emite:** `media:status` (UserPresence completo) → otros miembros de la sala.

---

#### `webrtc:offer` / `webrtc:answer` / `webrtc:ice-candidate`
Señalización WebRTC peer-to-peer. El servidor actúa como relay — **no interpreta** el contenido.

```ts
socket.emit("webrtc:offer", {
  roomId: "abc123",
  toSocketId: "socket-destino",
  offer: { /* RTCSessionDescription */ }
})
```

**Emite:** el evento correspondiente directamente al socket `toSocketId` con `fromSocketId` añadido.

---

#### `ping`
Health check de la conexión desde el cliente.

```ts
socket.emit("ping")
// Responde con: socket.on("pong")
```

---

### Servidor → Cliente

| Evento | Payload | Cuándo se emite |
|---|---|---|
| `usersOnline` | `UserPresence[]` | Tras `newUser` o desconexión de cualquier socket |
| `roomUsers` | `UserPresence[]` | Tras `joinRoom`, `leaveRoom` o desconexión |
| `userJoined` | `UserPresence` | Cuando otro usuario entra a tu sala |
| `userLeft` | `{ socketId, roomId }` | Cuando otro usuario sale o se desconecta |
| `message:new` | `{ uid, username, text, timestamp }` | Nuevo mensaje en la sala |
| `message:error` | `{ code, message }` | Error al enviar mensaje |
| `errorMessage` | `{ code, message }` | Error general (joinRoom, mediaStatus…) |
| `media:status` | `UserPresence` | Cambio de estado AV de otro usuario |
| `webrtc:offer` | `{ fromSocketId, roomId, offer }` | Oferta WebRTC reenviada |
| `webrtc:answer` | `{ fromSocketId, roomId, answer }` | Respuesta WebRTC reenviada |
| `webrtc:ice-candidate` | `{ fromSocketId, roomId, candidate }` | ICE candidate reenviado |
| `pong` | — | Respuesta a `ping` |

### Modelo `UserPresence`

```ts
interface UserPresence {
  socketId: string;
  uid: string | null;       // Firebase UID
  roomId: string | null;    // null si no está en ninguna sala
  isMuted: boolean;
  isVideoOff: boolean;
  isScreenSharing: boolean;
}
```

---

## Casos edge validados

Los siguientes casos son verificados explícitamente en [`register-socket-handlers.ts`](./src/socket/register-socket-handlers.ts):

| # | Caso | Acción del servidor |
|---|---|---|
| 1 | Conexión sin token | Rechazada en handshake (`Authentication error`) |
| 2 | Token expirado o inválido | Rechazada en handshake |
| 3 | `joinRoom` con `roomId` vacío o ausente | `errorMessage { code: "INVALID_ROOM" }` |
| 4 | `joinRoom` a sala que no existe en Firestore | `errorMessage { code: "ROOM_NOT_FOUND" }` |
| 5 | `joinRoom` con mismo uid ya en esa sala (otra pestaña) | `errorMessage { code: "ALREADY_IN_ROOM" }` — **no** bloquea unirse a una sala diferente |
| 6 | `joinRoom` cuando ya estás en otra sala | Sale automáticamente de la sala anterior (`safeLeaveRoom`) antes de entrar |
| 7 | `message:send` sin estar en ninguna sala | `message:error { code: "NO_ROOM" }` |
| 8 | `message:send` con texto vacío o solo espacios | `message:error { code: "EMPTY_MESSAGE" }` |
| 9 | `message:send` con uid ausente en socket.data | `message:error { code: "UNAUTHORIZED" }` |
| 10 | `message:send` sin username en socket.data | `message:error { code: "UNAUTHORIZED" }` (usuario anónimo) |
| 11 | `leaveRoom` sin estar en ninguna sala | No-op silencioso |
| 12 | Desconexión abrupta (cierre de pestaña) | Igual que `leaveRoom`: notifica `userLeft`, actualiza `roomUsers`, limpia presencia |
| 13 | `media:status` con `roomId` vacío | `errorMessage { code: "INVALID_ROOM" }` |
| 14 | Error al persistir mensaje en Firestore | Se loguea el error pero **no interrumpe** el broadcast (el cliente ya recibió el mensaje) |

---

## Persistencia en Firestore

La presencia de usuarios (`in-memory-store.ts`) es **solo en memoria** — se pierde al reiniciar el proceso. Esto es intencional: la presencia es efímera por naturaleza.

Los mensajes de chat sí se persisten en Firestore mediante `ChatService.saveMessage()`:

```
rooms/
  {roomId}/
    messages/
      {auto-id}/
        uid: string
        username: string
        text: string
        timestamp: string (ISO 8601)
```

El historial de mensajes **no** se expone desde este servidor — se consume desde el `backend` NestJS en `GET /api/rooms/:roomId/messages`.

---

## Ejecutar en local

```bash
# 1. Instala dependencias
npm install

# 2. Configura variables de entorno
cp .env.example .env
# Edita .env con tus credenciales de Firebase

# 3. Inicia en modo desarrollo (recarga automática)
npm run dev

# 4. Para verificar que funciona
curl http://localhost:3001/health
```

### Herramienta de prueba manual

Abre [`test-socket.html`](./test-socket.html) en el navegador (requiere un servidor estático, ej. `npx serve . -p 3002`).

---

## Documentación interactiva de eventos

Abre [`docs/socket-events.html`](./docs/socket-events.html) en el navegador para ver la documentación visual de todos los eventos Socket.IO, inspirada en el estilo Swagger.

---

## Despliegue en Render

| Campo | Valor |
|---|---|
| **Environment** | Node |
| **Build Command** | `npm install && npm run build` |
| **Start Command** | `npm start` |
| **Health Check Path** | `/health` |
| **Variables requeridas** | `PORT`, `CORS_ORIGIN`, `BACKEND_URL`, `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` |