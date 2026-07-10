# Studeo Backend Realtime

Servidor realtime para salas de estudio colaborativo. Esta capa usa Express, Socket.IO, TypeScript y Firebase Admin para manejar presencia, chat en vivo, moderacion de sala, reacciones y senalizacion WebRTC.

## Rol dentro del sistema

| Capa | Rol | Puerto local |
|---|---|---|
| `frontend` | SPA React/Vite | `5173` |
| `backend` | API REST NestJS | `3000` |
| `backend-realtime` | Socket.IO y endpoints de infraestructura | `3001` |

El audio, video y pantalla no pasan por este servidor. Socket.IO solo transporta eventos de sala y senales WebRTC (`offer`, `answer`, `ice-candidate`); los medios viajan entre navegadores o por TURN si ICE lo necesita.

## Stack

| Paquete | Version en `package.json` | Uso |
|---|---|---|
| `express` | `^5.2.1` | Servidor HTTP |
| `socket.io` | `^4.8.3` | Eventos realtime |
| `firebase-admin` | `^13.10.0` | Verificacion de JWT y Firestore |
| `cors` | `^2.8.6` | CORS |
| `dotenv` | `^17.4.2` | Variables de entorno |
| `tsx` | `^4.22.3` | Desarrollo con watch |
| `typescript` | `^6.0.3` | Tipado |

## Estructura

```text
backend-realtime/
├── docs/
│   ├── ARCHITECTURE.md
│   └── socket-events.html
├── src/
│   ├── config/
│   │   ├── env.ts
│   │   └── firebase.config.ts
│   ├── services/
│   │   └── chat.service.ts
│   ├── socket/
│   │   ├── auth.middleware.ts
│   │   ├── in-memory-store.ts
│   │   ├── register-socket-handlers.ts
│   │   └── room-reactions.ts
│   ├── types/
│   │   └── socket-events.ts
│   ├── utils/
│   │   └── logger.ts
│   ├── app.ts
│   └── index.ts
├── .env.example
├── test-socket.html
└── package.json
```

## Variables de entorno

El archivo `.env.example` contiene la plantilla esperada por el codigo:

```env
NODE_ENV=development
PORT=3001
CORS_ORIGIN=http://localhost:5173
BACKEND_URL=http://localhost:3000
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_CLIENT_EMAIL=firebase-adminsdk@your-project.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
```

## Ejecutar en local

```bash
npm install
cp .env.example .env
npm run dev
```

Verificaciones:

```bash
curl http://localhost:3001/health
```

URLs utiles:

- `GET /`: informacion basica del servicio.
- `GET /health`: health check.
- `GET /docs`: documentacion visual de eventos Socket.IO.

## Scripts

```bash
npm run dev        # tsx watch src/index.ts
npm run build      # tsc -p tsconfig.json
npm start          # node dist/index.js
npm run typecheck  # tsc --noEmit
npm run check      # alias de typecheck
```

## Autenticacion Socket.IO

Cada conexion debe enviar un Firebase ID Token en el handshake:

```ts
const socket = io("http://localhost:3001", {
  auth: {
    token: await firebase.auth().currentUser.getIdToken(),
  },
})
```

`authSocketMiddleware` valida el token con Firebase Admin. Si es valido, enriquece `socket.data` con `uid`, `email`, `username`, `name` y `avatarUrl` cuando estan disponibles. Si el token falta o es invalido, la conexion se rechaza.

## Endpoints HTTP

Estos endpoints son de infraestructura. La logica de salas ocurre por Socket.IO.

| Metodo | Ruta | Auth | Descripcion |
|---|---|---|---|
| `GET` | `/` | No | Nombre y estado basico del servicio |
| `GET` | `/health` | No | Estado, uptime y timestamp |
| `GET` | `/docs` | No | Sirve `docs/socket-events.html` |

## Eventos Cliente a Servidor

| Evento | Payload | Descripcion |
|---|---|---|
| `newUser` | ninguno | Registra/actualiza presencia global |
| `joinRoom` | `{ roomId, isMuted?, isVideoOff? }` | Entra a una sala existente en Firestore |
| `leaveRoom` | `roomId?` | Sale de la sala indicada o de la sala actual |
| `roomUsersPrevisualization` | `{ roomId, socketId }` | Solicita snapshot de usuarios de una sala |
| `message:send` | `{ text }` | Envia mensaje a la sala actual |
| `media:status` | `{ roomId?, isMuted?, isVideoOff?, isScreenSharing?, ...debug }` | Actualiza estado de medios |
| `reaction:send` | `{ roomId, emoji }` | Envia reaccion permitida con rate limit |
| `roomMemberRemoved` | `{ roomId, uid? }` | Salida propia o expulsion si el emisor es owner |
| `roomMemberMuted` | `{ roomId, uid }` | Solicitud del owner para silenciar participante |
| `deleteRoom` | `{ roomId }` | Notifica eliminacion realtime si el emisor es owner |
| `webrtc:offer` | `{ roomId, toSocketId, offer }` | Reenvia oferta SDP |
| `webrtc:answer` | `{ roomId, toSocketId, answer }` | Reenvia respuesta SDP |
| `webrtc:ice-candidate` | `{ roomId, toSocketId, candidate }` | Reenvia ICE candidate |
| `caption:update` | `{ roomId, text, isFinal }` | Reenvia un subtítulo generado por el cliente que los activó |
| `caption:clear` | `{ roomId }` | Limpia el subtítulo activo del emisor para la sala |
| `ping` | ninguno | Responde `pong` |

## Eventos Servidor a Cliente

| Evento | Payload | Cuando se emite |
|---|---|---|
| `usersOnline` | `UserPresence[]` | Cambios de presencia global |
| `roomUsers` | `UserPresence[]` | Cambios de participantes en sala |
| `userJoined` | `UserPresence` | Un socket entra a la sala |
| `userLeft` | `{ socketId, roomId }` | Un socket sale o se desconecta |
| `roomMemberRemoved` | `{ roomId, uid }` | Salida/expulsion de miembro |
| `roomMemberMuted` | `{ roomId, uid }` | El owner solicita silenciar a un usuario |
| `roomDeleted` | `{ roomId, deletedBy, reason }` | El owner elimina la sala |
| `message:new` | `{ uid, username, text, timestamp }` | Nuevo mensaje |
| `message:error` | `{ code, message }` | Error al enviar mensaje |
| `errorMessage` | `{ code, message }` | Error general |
| `media:status` | `UserPresence` | Cambio de audio/video/pantalla |
| `reaction:new` | `{ id, roomId, socketId, uid, username, emoji, createdAt }` | Nueva reaccion |
| `webrtc:offer` | `{ fromSocketId, roomId, offer }` | Oferta reenviada |
| `webrtc:answer` | `{ fromSocketId, roomId, answer }` | Respuesta reenviada |
| `webrtc:ice-candidate` | `{ fromSocketId, roomId, candidate }` | ICE candidate reenviado |
| `caption:update` | `{ roomId, socketId, uid, username, text, isFinal, updatedAt }` | Envía un subtítulo a los participantes de la sala |
| `caption:clear` | `{ roomId, socketId, uid, username, updatedAt }` | Limpia el subtítulo activo del emisor en la sala |
| `pong` | ninguno | Respuesta a `ping` |

## Subtítulos en tiempo real

Los subtítulos no pasan por el backend como audio ni como video. El flujo actual es:

1. El frontend activa la transcripción local del micrófono del usuario que habilitó los subtítulos.
2. El cliente emite `caption:update` con el texto reconocido.
3. El servidor Socket.IO reenvía el payload a todos los sockets conectados a la misma sala mediante `caption:update`.
4. El frontend muestra el texto sobre el tile del participante correspondiente.

### Validaciones del servidor

- El evento solo se acepta si el socket está unido a la sala indicada.
- Se rechaza silenciosamente cuando el texto está vacío.
- El texto se recorta a 240 caracteres antes de reenviarlo.
- `caption:clear` se usa para limpiar el subtítulo activo del emisor en la sala.

### Comportamiento esperado en frontend

- Si no se puede activar la transcripción local (micrófono bloqueado, navegador sin soporte, error del worker o fallo del flujo), el frontend muestra un toast de error y conserva la llamada activa.
- El usuario que activó los subtítulos puede detenerlos en cualquier momento y el estado se limpia para la sala.

## Persistencia

La presencia vive en memoria (`in-memory-store.ts`) y se pierde al reiniciar el proceso. Los mensajes se persisten en Firestore desde `message:send` mediante `ChatService.saveMessage()`.

Estructura esperada:

```text
rooms/{roomId}/messages/{auto-id}
  uid: string
  username: string
  text: string
  timestamp: string
```

## Casos validados por codigo

- Rechazo de conexion sin token o con token invalido.
- Rechazo de `joinRoom` sin `roomId`, con sala inexistente o con el mismo `uid` ya conectado a esa sala.
- Salida automatica de la sala anterior antes de entrar a otra.
- Rechazo de mensajes sin usuario, sin sala, sin username o con texto vacio.
- Validacion de emisor/receptor en la misma sala antes de reenviar WebRTC.
- Validacion de owner para `deleteRoom`, expulsion de otros usuarios y mute remoto.
- Limpieza de presencia y rate limit de reacciones al desconectar.

## Despliegue sugerido

| Campo | Valor |
|---|---|
| Environment | Node |
| Build Command | `npm install && npm run build` |
| Start Command | `npm start` |
| Health Check Path | `/health` |
| Variables requeridas | `PORT`, `CORS_ORIGIN`, `BACKEND_URL`, `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` |
