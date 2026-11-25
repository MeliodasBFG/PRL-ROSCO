import { INITIAL_PRL_QUESTION_BANK } from '../shared/prlQuestionBank';
import { RoomConfig } from '../shared/types';
import { Env, RoscoRoomDO } from './RoscoRoomDO';

export { RoscoRoomDO };

// ============================================================================
// CLOUDFLARE WORKER ENTRYPOINT — PRL-ROSCO API & WEBSOCKET ROUTER
// Recursos independientes: Worker "prl-rosco-api", D1 "prl-rosco-db", DO "RoscoRoomDO"
// ============================================================================

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Auth-Token',
};

function withCors(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries(CORS_HEADERS)) {
    headers.set(k, v);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * Genera un código de sala legible de 6 caracteres (sin caracteres ambiguos como 0/O o 1/I)
 */
function generateRoomCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  const randomValues = new Uint32Array(6);
  crypto.getRandomValues(randomValues);
  for (let i = 0; i < 6; i++) {
    code += alphabet[randomValues[i] % alphabet.length];
  }
  return code;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    try {
      // 1. Healthcheck e información del servicio independiente PRL-ROSCO
      if (path === '/api/health') {
        return withCors(
          Response.json({
            ok: true,
            service: 'prl-rosco-api',
            appName: env.APP_NAME || 'PRL-ROSCO',
            maxContestants: Number(env.MAX_CONTESTANTS || 15),
            questionBankCount: INITIAL_PRL_QUESTION_BANK.length,
            timestamp: Date.now(),
          })
        );
      }

      // 2. Crear nueva sala de concurso (genera código único y hostToken criptográfico para el presentador)
      if (path === '/api/rooms' && request.method === 'POST') {
        const body = (await request.json().catch(() => ({}))) as {
          config?: Partial<RoomConfig>;
          customCode?: string;
        };

        const roomCode = (body.customCode?.trim().toUpperCase() || generateRoomCode()).slice(0, 8);
        const roomId = `room-${roomCode}`;
        const hostToken = `htok_${crypto.randomUUID().replace(/-/g, '')}`;

        const doId = env.ROSCO_ROOMS.idFromName(roomCode);
        const stub = env.ROSCO_ROOMS.get(doId);

        const initResp = await stub.fetch('https://rosco-do/init', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            roomId,
            roomCode,
            hostToken,
            config: body.config,
          }),
        });

        const initData = (await initResp.json()) as Record<string, unknown>;
        return withCors(
          Response.json({
            ...initData,
            roomId,
            roomCode,
            hostToken,
          })
        );
      }

      // 3. Enrutamiento a una sala específica por su código: /api/rooms/:code/...
      const roomMatch = path.match(/^\/api\/rooms\/([A-Za-z0-9_-]+)(?:\/(.*))?$/);
      if (roomMatch) {
        const roomCode = roomMatch[1].toUpperCase();
        const subPath = roomMatch[2] || 'state';

        const doId = env.ROSCO_ROOMS.idFromName(roomCode);
        const stub = env.ROSCO_ROOMS.get(doId);

        // Si es una actualización WebSocket, reenviar directamente al Durable Object sin alterar headers 101
        if (request.headers.get('Upgrade')?.toLowerCase() === 'websocket') {
          return stub.fetch(request);
        }

        const forwardUrl = new URL(request.url);
        forwardUrl.pathname = `/${subPath}`;

        const doResp = await stub.fetch(
          new Request(forwardUrl.toString(), {
            method: request.method,
            headers: request.headers,
            body:
              request.method !== 'GET' && request.method !== 'HEAD'
                ? await request.text()
                : undefined,
          })
        );

        return withCors(doResp);
      }

      return withCors(
        Response.json(
          { ok: false, code: 'NOT_FOUND', message: `Ruta no encontrada: ${path}` },
          { status: 404 }
        )
      );
    } catch (err) {
      return withCors(
        Response.json(
          {
            ok: false,
            code: 'WORKER_ERROR',
            message: err instanceof Error ? err.message : 'Error en Worker PRL-ROSCO',
          },
          { status: 500 }
        )
      );
    }
  },
};
