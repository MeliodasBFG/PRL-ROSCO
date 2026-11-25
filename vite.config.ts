import { defineConfig, Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { AuthoritativeRoscoRoom, RoscoSecurityError } from './shared/roscoGameEngine';
import { INITIAL_PRL_QUESTION_BANK } from './shared/prlQuestionBank';

/**
 * Middleware autoritativo integrado para desarrollo local con Vite.
 * Ejecuta exactamente el mismo motor de servidor (AuthoritativeRoscoRoom) que el Durable Object RoscoRoomDO,
 * permitiendo sincronizar múltiples pestañas y dispositivos en tiempo real tanto con `npm run dev`
 * como con `wrangler dev`.
 */
function prlRoscoServerPlugin(): Plugin {
  const rooms = new Map<string, AuthoritativeRoscoRoom>();

  function generateCode(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let out = '';
    for (let i = 0; i < 6; i++) {
      out += chars[Math.floor(Math.random() * chars.length)];
    }
    return out;
  }

  function readBody(req: any): Promise<any> {
    return new Promise((resolve) => {
      let data = '';
      req.on('data', (chunk: any) => (data += chunk));
      req.on('end', () => {
        try {
          resolve(data ? JSON.parse(data) : {});
        } catch {
          resolve({});
        }
      });
    });
  }

  function sendJson(res: any, status: number, payload: unknown) {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Auth-Token');
    res.end(JSON.stringify(payload));
  }

  return {
    name: 'prl-rosco-authoritative-server',
    configureServer(server) {
      const timer = setInterval(() => {
        const now = Date.now();
        for (const room of rooms.values()) {
          room.syncActiveTimer(now);
        }
      }, 500);
      (timer as any).unref?.();
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/api/')) return next();

        if (req.method === 'OPTIONS') {
          return sendJson(res, 204, {});
        }

        const url = new URL(req.url, 'http://localhost:5173');
        const path = url.pathname;

        try {
          if (path === '/api/health') {
            return sendJson(res, 200, {
              ok: true,
              service: 'prl-rosco-api',
              maxContestants: 15,
              questionBankCount: INITIAL_PRL_QUESTION_BANK.length,
              timestamp: Date.now(),
            });
          }

          if (path === '/api/rooms' && req.method === 'POST') {
            const body = await readBody(req);
            const roomCode = (body.customCode?.trim()?.toUpperCase() || generateCode()).slice(0, 8);
            const roomId = `room-${roomCode}`;
            const hostToken = `htok_${crypto.randomUUID().replace(/-/g, '')}`;

            const room = new AuthoritativeRoscoRoom({
              roomId,
              roomCode,
              hostToken,
              config: body.config,
            });
            rooms.set(roomCode, room);

            return sendJson(res, 200, {
              ok: true,
              roomId,
              roomCode,
              hostToken,
              publicState: room.getPublicState(),
              presenterPrivate: room.getPresenterPrivateState(hostToken),
            });
          }

          const match = path.match(/^\/api\/rooms\/([A-Za-z0-9_-]+)(?:\/(.*))?$/);
          if (match) {
            const roomCode = match[1].toUpperCase();
            const subPath = match[2] || 'state';
            const room = rooms.get(roomCode);

            if (!room) {
              return sendJson(res, 404, {
                ok: false,
                code: 'ROOM_NOT_FOUND',
                message: `No existe ninguna sala activa con el código ${roomCode}.`,
              });
            }

            room.syncActiveTimer();
            const token =
              (req.headers['x-auth-token'] as string | undefined) ||
              url.searchParams.get('token') ||
              undefined;

            if (subPath === 'join' && req.method === 'POST') {
              const body = await readBody(req);
              const joined = room.joinContestant({
                name: body.name || '',
                avatar: body.avatar,
                playerToken: body.playerToken,
              });
              return sendJson(res, 200, {
                ok: true,
                playerId: joined.playerId,
                playerToken: joined.playerToken,
                publicState: room.getPublicState(),
              });
            }

            if (subPath === 'state' && req.method === 'GET') {
              return sendJson(res, 200, {
                ok: true,
                publicState: room.getPublicState(),
                presenterPrivate: room.isHostToken(token)
                  ? room.getPresenterPrivateState(token)
                  : undefined,
              });
            }

            if (subPath === 'action' && req.method === 'POST') {
              const payload = await readBody(req);
              const event = room.executePresenterAction(token, payload);
              return sendJson(res, 200, {
                ok: true,
                event,
                publicState: room.getPublicState(),
                presenterPrivate: room.getPresenterPrivateState(token),
              });
            }

            if (subPath === 'questions' && req.method === 'GET') {
              room.verifyHostToken(token);
              return sendJson(res, 200, {
                ok: true,
                questions: room.getQuestionBank(),
              });
            }

            if (subPath === 'questions' && req.method === 'POST') {
              const body = await readBody(req);
              const saved = room.upsertQuestionInBank(token, body);
              return sendJson(res, 200, {
                ok: true,
                question: saved,
              });
            }

            if (subPath === 'results' && req.method === 'GET') {
              return sendJson(res, 200, {
                ok: true,
                results: room.pastResults,
              });
            }
          }

          return sendJson(res, 404, { ok: false, message: 'Ruta API no encontrada' });
        } catch (err) {
          if (err instanceof RoscoSecurityError) {
            return sendJson(res, err.httpStatus, {
              ok: false,
              code: err.code,
              message: err.message,
            });
          }
          return sendJson(res, 500, {
            ok: false,
            code: 'SERVER_ERROR',
            message: err instanceof Error ? err.message : 'Error interno',
          });
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), prlRoscoServerPlugin()],
  server: {
    port: 5173,
    host: true,
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    chunkSizeWarningLimit: 1600,
  },
});
