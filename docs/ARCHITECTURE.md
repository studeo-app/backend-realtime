# Arquitectura y decisiones tecnicas

## 1) Objetivo de esta entrega

Levantar la **infraestructura base del backend realtime** para habilitar:

- TS-02: WebSockets + modelado de salas/chat.
- TS-03: signaling para WebRTC.

Se construyo una base enfocada en velocidad de iteracion y mantenibilidad.

## 2) Decisiones de arquitectura

## Decision A - Separar HTTP de Socket

Se usa `Express` para endpoints HTTP (`/`, `/health`) y `Socket.IO` para eventos realtime.

**Por que:**

- Render puede usar healthcheck HTTP.
- Se desacopla API REST de eventos realtime.
- Permite crecer hacia Swagger en el backend principal sin mezclar responsabilidades.

## Decision B - Tipar los eventos Socket.IO

Se definieron interfaces en `src/types/socket-events.ts` para ambos sentidos (cliente-servidor y servidor-cliente).

**Por que:**

- Previene errores por nombres/payload incorrecto.
- Mejora DX al integrar frontend TypeScript.
- Facilita versionar contratos de eventos.

## Decision C - Estado en memoria para esta fase

Se implemento `src/socket/in-memory-store.ts` con `Map` para usuarios y mensajes.

**Por que (fase base):**

- Permite probar flujos realtime en minutos.
- Reduce complejidad inicial y bloqueos de infraestructura.
- Sirve como adaptador temporal antes de mover a Firestore.

**Limitacion conocida:**

- Si el proceso reinicia, se pierde estado. Esto es esperado para esta base.

## Decision D - Handler central de sockets

`src/socket/register-socket-handlers.ts` concentra conexion, validaciones, emisiones y limpieza.

**Por que:**

- Punto unico para reglas de negocio realtime.
- Facil para dividir luego en modulos (`chat.handlers`, `webrtc.handlers`, etc.).
- Mejora trazabilidad para depuracion.

## Decision E - Variables de entorno tipadas

`src/config/env.ts` centraliza lectura y defaults de `PORT`, `FRONTEND_URL` y `NODE_ENV`.

**Por que:**

- Evita leer `process.env` en muchos archivos.
- Disminuye errores de configuracion al desplegar.
- Mantiene entradas de configuracion auditables.

## Decision F - Logging estructurado simple

Se implemento `src/utils/logger.ts` con salida JSON por `console`.

**Por que:**

- Logs legibles por Render.
- Facil de migrar luego a `pino` o servicios externos sin tocar handlers.

## 3) Cobertura de historias objetivo

Esta base habilita el camino para:

- **US-06/US-07/US-08**: unirse/salir y presencia por sala.
- **US-10**: mensajeria instantanea.
- **US-11**: historial temporal (ya listo el contrato para persistencia real).
- **US-12/US-13/US-14**: intercambio de ofertas/respuestas/ICE y estados AV.

## 4) Flujo realtime implementado

1. Cliente conecta -> se registra presencia.
2. Cliente define username (`newUser`).
3. Cliente entra a sala (`joinRoom`) -> se emiten `userJoined` + `roomUsers`.
4. Cliente envia texto (`message:send`) -> broadcast `message:new` + persistencia asincrona en Firestore.
5. El historial se lee por HTTP desde el backend NestJS (`GET /api/rooms/:roomId/messages`).
6. Clientes intercambian signaling WebRTC (`webrtc:offer`, `webrtc:answer`, `webrtc:ice-candidate`).
7. El servidor solo reenvia senales P2P: los medios viajan navegador a navegador o por TURN si ICE lo requiere.
8. Cliente actualiza estado AV (`media:status`).
9. Cliente sale o se desconecta -> limpieza + notificaciones.

## 5) Preparado para proxima iteracion

## Firestore

Para cumplir completamente TS-02/US-11 en produccion:

- reemplazar metodos de `in-memory-store.ts` por repositorios Firestore.
- agregar colecciones `rooms`, `messages`, `roomParticipants`.

## Seguridad y hardening

Implementado:

- auth de sockets con token Firebase (`io.use` middleware).

En sprint posterior se recomienda:

- rate limit / anti-spam para `message:send`.
- validacion robusta de payloads (ej. `zod`).

## Escalado

Si crece concurrencia:

- Redis Adapter para Socket.IO (multi-instancia).
- persistencia de sesiones/presencia.

## 6) Compatibilidad con Render

Confirmado para despliegue con:

- `npm run build`
- `npm start`
- healthcheck `GET /health`
- CORS por `FRONTEND_URL`
