import { describe, it, expect } from 'vitest';
import workerEntry, { RoscoRoomDO } from '../worker/index';
import { Env } from '../worker/RoscoRoomDO';

/**
 * Arnés de pruebas en memoria para simular el namespace de Durable Objects de Cloudflare
 * y probar de extremo a extremo el Worker `prl-rosco-api` y la clase `RoscoRoomDO`.
 */
function createMockCloudflareEnv(): Env {
  const instances = new Map<string, RoscoRoomDO>();

  const namespace: any = {
    idFromName(name: string) {
      return { toString: () => name, name };
    },
    get(id: any) {
      const key = id.toString();
      if (!instances.has(key)) {
        const mockState: any = {
          id,
          storage: {
            setAlarm: async () => {},
            get: async () => undefined,
            put: async () => {},
          },
        };
        instances.set(key, new RoscoRoomDO(mockState, { ROSCO_ROOMS: namespace }));
      }
      const instance = instances.get(key)!;
      return {
        fetch: (req: Request | string, init?: RequestInit) => {
          const request = typeof req === 'string' ? new Request(req, init) : req;
          return instance.fetch(request);
        },
      };
    },
  };

  return {
    ROSCO_ROOMS: namespace,
    APP_NAME: 'PRL-ROSCO',
    MAX_CONTESTANTS: '15',
    DEFAULT_TIMER_SECONDS: '120',
  };
}

describe('PRL-ROSCO — Pruebas de Integración de Cloudflare Worker y Durable Object RoscoRoomDO', () => {
  it('responde correctamente en /api/health con 135 preguntas en el banco', async () => {
    const env = createMockCloudflareEnv();
    const res = await workerEntry.fetch(new Request('https://prl-rosco.workers.dev/api/health'), env);
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.ok).toBe(true);
    expect(data.service).toBe('prl-rosco-api');
    expect(data.maxContestants).toBe(15);
    expect(data.questionBankCount).toBe(135);
  });

  it('ejecuta un flujo completo de sala en RoscoRoomDO: creación, entrada de concursantes, inicio, acierto, Pasapalabra con cesión de turno y protección de seguridad', async () => {
    const env = createMockCloudflareEnv();

    // 1. El profesor crea la sala
    const createRes = await workerEntry.fetch(
      new Request('https://prl-rosco.workers.dev/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customCode: 'PRL3D',
          config: {
            roomName: 'Aula Prevención 3D',
            timerSeconds: 120,
            pointsCorrect: 10,
          },
        }),
      }),
      env
    );
    expect(createRes.status).toBe(200);
    const created = (await createRes.json()) as any;
    expect(created.ok).toBe(true);
    expect(created.roomCode).toBe('PRL3D');
    expect(created.hostToken).toMatch(/^htok_/);
    const hostToken = created.hostToken;

    // 2. Entran dos concursantes
    const join1Res = await workerEntry.fetch(
      new Request('https://prl-rosco.workers.dev/api/rooms/PRL3D/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Javier' }),
      }),
      env
    );
    const join1 = (await join1Res.json()) as any;
    expect(join1.ok).toBe(true);
    expect(join1.playerToken).toMatch(/^ptok_/);

    const join2Res = await workerEntry.fetch(
      new Request('https://prl-rosco.workers.dev/api/rooms/PRL3D/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Ana' }),
      }),
      env
    );
    const join2 = (await join2Res.json()) as any;
    expect(join2.ok).toBe(true);

    // 3. El presentador inicia la partida
    const startRes = await workerEntry.fetch(
      new Request('https://prl-rosco.workers.dev/api/rooms/PRL3D/action', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Auth-Token': hostToken,
        },
        body: JSON.stringify({
          type: 'START_GAME',
          actionId: 'do-start-1',
        }),
      }),
      env
    );
    const started = (await startRes.json()) as any;
    expect(started.ok).toBe(true);
    expect(started.publicState.status).toBe('PLAYING');
    expect(started.publicState.activePlayerId).toBe(join1.playerId);
    expect(started.publicState.activeLetter).toBe('A');

    // 4. Un concursante consulta /state con su playerToken -> NO recibe presenterPrivate
    const contestantStateRes = await workerEntry.fetch(
      new Request('https://prl-rosco.workers.dev/api/rooms/PRL3D/state', {
        headers: { 'X-Auth-Token': join1.playerToken },
      }),
      env
    );
    const contestantView = (await contestantStateRes.json()) as any;
    expect(contestantView.presenterPrivate).toBeUndefined();
    expect(contestantView.publicState.activeQuestion.mainAnswer).toBeUndefined();

    // 5. Un concursante intenta invocar /action para marcarse ACIERTO -> 403 Forbidden
    const unauthorizedRes = await workerEntry.fetch(
      new Request('https://prl-rosco.workers.dev/api/rooms/PRL3D/action', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Auth-Token': join1.playerToken,
        },
        body: JSON.stringify({
          type: 'MARK_CORRECT',
          actionId: 'cheat-attempt',
          expectedPlayerId: join1.playerId,
          expectedLetter: 'A',
          expectedQuestionId: started.publicState.activeQuestion.id,
        }),
      }),
      env
    );
    expect(unauthorizedRes.status).toBe(403);

    // 6. El presentador registra PASAPALABRA y elige OPCIÓN 2: Ceder el turno a Ana
    const pasaRes = await workerEntry.fetch(
      new Request('https://prl-rosco.workers.dev/api/rooms/PRL3D/action', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Auth-Token': hostToken,
        },
        body: JSON.stringify({
          type: 'REGISTER_PASAPALABRA',
          actionId: 'do-pasa-1',
          expectedPlayerId: join1.playerId,
          expectedLetter: 'A',
          expectedQuestionId: started.publicState.activeQuestion.id,
        }),
      }),
      env
    );
    const pasaData = (await pasaRes.json()) as any;
    expect(pasaData.publicState.awaitingPasapalabraDecision).toBe(true);

    const transferRes = await workerEntry.fetch(
      new Request('https://prl-rosco.workers.dev/api/rooms/PRL3D/action', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Auth-Token': hostToken,
        },
        body: JSON.stringify({
          type: 'PASAPALABRA_DECISION',
          actionId: 'do-transfer-1',
          decision: 'TRANSFER_TURN',
          nextPlayerId: join2.playerId,
        }),
      }),
      env
    );
    const transferData = (await transferRes.json()) as any;
    expect(transferData.ok).toBe(true);
    expect(transferData.publicState.activePlayerId).toBe(join2.playerId);
    expect(transferData.publicState.activeLetter).toBe('A');
  });
});
