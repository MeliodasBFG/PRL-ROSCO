import { describe, it, expect } from 'vitest';
import workerEntry, { RoscoRoomDO } from '../worker/index';
import { Env } from '../worker/RoscoRoomDO';
import { ROSCO_LETTERS } from '../shared/types';
import { INITIAL_PRL_QUESTION_BANK } from '../shared/prlQuestionBank';

// ============================================================================
// ARNÉS DE PRUEBAS CON SQLITE REAL (node:sqlite) PARA DURABLE OBJECTS Y D1
// Simula almacenamiento persistente SQLite por instancia de Durable Object,
// reinicios/evicciones creando nuevas instancias sobre el mismo SQLite,
// blockConcurrencyWhile, transactionSync, D1 coherente y WebSockets.
// ============================================================================

async function loadNodeSqlite(): Promise<{ DatabaseSync: new (path: string) => any }> {
  const proc = (globalThis as any).process;
  return proc.getBuiltinModule('node:sqlite');
}

class FakeWebSocket {
  public readyState = 1;
  public sentMessages: string[] = [];
  public receivedMessages: string[] = [];
  private listeners: Map<string, Array<(ev: any) => void>> = new Map();
  private attachment: unknown = null;
  public peer: FakeWebSocket | null = null;

  public accept() {}
  public serializeAttachment(val: unknown) {
    this.attachment = JSON.parse(JSON.stringify(val));
  }
  public deserializeAttachment() {
    return this.attachment;
  }
  public send(data: string) {
    this.sentMessages.push(data);
    if (this.peer) {
      this.peer.receivedMessages.push(data);
      this.peer.emit('message', { data });
    }
  }
  public close() {
    this.readyState = 3;
    this.emit('close', {});
  }
  public addEventListener(event: string, cb: (ev: any) => void) {
    const arr = this.listeners.get(event) ?? [];
    arr.push(cb);
    this.listeners.set(event, arr);
  }
  public emit(event: string, ev: any) {
    for (const cb of this.listeners.get(event) ?? []) {
      cb(ev);
    }
  }
}

function createPersistentSqlStorage(sqliteDb: any) {
  return {
    sql: {
      exec(query: string, ...bindings: any[]) {
        const trimmed = query.trim();
        // Soporte para múltiples sentencias DDL en una llamada
        if (bindings.length === 0 && /^(CREATE|PRAGMA)\b/i.test(trimmed)) {
          sqliteDb.exec(trimmed);
          const empty: any[] = [];
          return {
            toArray: () => empty,
            one: () => undefined,
            [Symbol.iterator]: () => empty[Symbol.iterator](),
          };
        }

        const stmt = sqliteDb.prepare(trimmed);
        const isReader = /^(SELECT|WITH|PRAGMA)\b/i.test(trimmed);
        const rows = isReader ? stmt.all(...bindings) : (stmt.run(...bindings), []);
        return {
          toArray: () => rows,
          one: () => rows[0],
          [Symbol.iterator]: () => rows[Symbol.iterator](),
        };
      },
    },
    transactionSync<T>(closure: () => T): T {
      sqliteDb.exec('BEGIN IMMEDIATE');
      try {
        const res = closure();
        sqliteDb.exec('COMMIT');
        return res;
      } catch (err) {
        try {
          sqliteDb.exec('ROLLBACK');
        } catch {
          // Ignorar rollback si ya cerró
        }
        throw err;
      }
    },
    setAlarm: async () => {},
    get: async () => undefined,
    put: async () => {},
  };
}

function createPersistentD1Mock(sqliteDb: any): D1Database {
  const createPrepared = (sql: string, boundParams: any[] = []) => ({
    bind(...args: any[]) {
      return createPrepared(sql, args);
    },
    async run() {
      const res = sqliteDb.prepare(sql).run(...boundParams);
      return { success: true, meta: res };
    },
    async all() {
      const rows = sqliteDb.prepare(sql).all(...boundParams);
      return { success: true, results: rows };
    },
    async first() {
      const rows = sqliteDb.prepare(sql).all(...boundParams);
      return rows[0] ?? null;
    },
  });

  return {
    prepare(sql: string) {
      return createPrepared(sql) as any;
    },
    async batch(statements: any[]) {
      sqliteDb.exec('BEGIN');
      try {
        const results = [];
        for (const stmt of statements) {
          results.push(await stmt.run());
        }
        sqliteDb.exec('COMMIT');
        return results;
      } catch (err) {
        sqliteDb.exec('ROLLBACK');
        throw err;
      }
    },
    async exec(sql: string) {
      sqliteDb.exec(sql);
      return { count: 1, duration: 0 };
    },
  } as any;
}

async function createPersistentCloudflareHarness(options?: {
  withD1Schema?: boolean;
  delayRestoreMs?: number;
}) {
  const { DatabaseSync } = await loadNodeSqlite();
  const doSqliteByRoom = new Map<string, any>();
  const instances = new Map<string, RoscoRoomDO>();
  const d1Sqlite = new DatabaseSync(':memory:');

  if (options?.withD1Schema) {
    d1Sqlite.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS rooms (id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL, is_public INTEGER NOT NULL DEFAULT 0, host_token_hash TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'WAITING', timer_seconds INTEGER NOT NULL DEFAULT 120, points_correct INTEGER NOT NULL DEFAULT 10, points_incorrect INTEGER NOT NULL DEFAULT 0, points_pasapalabra INTEGER NOT NULL DEFAULT 0, show_leaderboard INTEGER NOT NULL DEFAULT 1, selected_categories TEXT NOT NULL DEFAULT '[]', selected_difficulty TEXT NOT NULL DEFAULT 'TODAS', active_player_id TEXT, current_round_id TEXT, state_version INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS players (id TEXT PRIMARY KEY, room_id TEXT NOT NULL, name TEXT NOT NULL, avatar_config TEXT NOT NULL, turn_order INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'WAITING', is_connected INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE, UNIQUE(room_id, name));
      CREATE TABLE IF NOT EXISTS player_sessions (token_hash TEXT PRIMARY KEY, room_id TEXT NOT NULL, player_id TEXT, role TEXT NOT NULL, created_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0, FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE);
      CREATE TABLE IF NOT EXISTS questions (id TEXT PRIMARY KEY, letter TEXT NOT NULL, mode TEXT NOT NULL, statement TEXT NOT NULL, main_answer TEXT NOT NULL, accepted_variants TEXT NOT NULL DEFAULT '[]', synonyms TEXT NOT NULL DEFAULT '[]', explanation TEXT NOT NULL, category TEXT NOT NULL, difficulty TEXT NOT NULL, source TEXT NOT NULL, source_url TEXT NOT NULL, reviewed_at TEXT NOT NULL, is_active INTEGER NOT NULL DEFAULT 1);
      CREATE TABLE IF NOT EXISTS game_rounds (id TEXT PRIMARY KEY, room_id TEXT NOT NULL, round_number INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'IN_PROGRESS', started_at INTEGER NOT NULL, finished_at INTEGER, FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE);
      CREATE TABLE IF NOT EXISTS round_questions (id TEXT PRIMARY KEY, round_id TEXT NOT NULL, room_id TEXT NOT NULL, letter TEXT NOT NULL, question_id TEXT NOT NULL, display_order INTEGER NOT NULL, FOREIGN KEY (round_id) REFERENCES game_rounds(id) ON DELETE CASCADE, FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE, FOREIGN KEY (question_id) REFERENCES questions(id), UNIQUE(round_id, letter));
      CREATE TABLE IF NOT EXISTS player_roscos (id TEXT PRIMARY KEY, round_id TEXT NOT NULL, room_id TEXT NOT NULL, player_id TEXT NOT NULL, current_letter TEXT NOT NULL DEFAULT 'A', lap_count INTEGER NOT NULL DEFAULT 1, status TEXT NOT NULL DEFAULT 'IN_PROGRESS', started_at INTEGER, finished_at INTEGER, FOREIGN KEY (round_id) REFERENCES game_rounds(id) ON DELETE CASCADE, FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE, FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE, UNIQUE(round_id, player_id));
      CREATE TABLE IF NOT EXISTS player_letter_states (id TEXT PRIMARY KEY, rosco_id TEXT NOT NULL, room_id TEXT NOT NULL, player_id TEXT NOT NULL, letter TEXT NOT NULL, question_id TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'UNSEEN', presentation_order INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, result TEXT NOT NULL DEFAULT 'PENDING', points_earned INTEGER NOT NULL DEFAULT 0, answered_at INTEGER, FOREIGN KEY (rosco_id) REFERENCES player_roscos(id) ON DELETE CASCADE, FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE, FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE, UNIQUE(rosco_id, letter));
      CREATE TABLE IF NOT EXISTS player_timers (player_id TEXT NOT NULL, room_id TEXT NOT NULL, round_id TEXT NOT NULL, initial_ms INTEGER NOT NULL, remaining_ms INTEGER NOT NULL, consumed_ms INTEGER NOT NULL DEFAULT 0, is_running INTEGER NOT NULL DEFAULT 0, last_started_at INTEGER, updated_at INTEGER NOT NULL, PRIMARY KEY (round_id, player_id), FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE, FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE);
      CREATE TABLE IF NOT EXISTS scores (player_id TEXT NOT NULL, room_id TEXT NOT NULL, round_id TEXT NOT NULL, correct_count INTEGER NOT NULL DEFAULT 0, incorrect_count INTEGER NOT NULL DEFAULT 0, pasapalabra_count INTEGER NOT NULL DEFAULT 0, pending_count INTEGER NOT NULL DEFAULT 27, total_points INTEGER NOT NULL DEFAULT 0, time_consumed_ms INTEGER NOT NULL DEFAULT 0, time_remaining_ms INTEGER NOT NULL DEFAULT 120000, accuracy_pct REAL NOT NULL DEFAULT 0, rank_position INTEGER NOT NULL DEFAULT 1, updated_at INTEGER NOT NULL, PRIMARY KEY (round_id, player_id), FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE, FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE);
      CREATE TABLE IF NOT EXISTS game_events (id TEXT PRIMARY KEY, room_id TEXT NOT NULL, round_id TEXT, seq INTEGER NOT NULL, event_type TEXT NOT NULL, actor_role TEXT NOT NULL, target_player_id TEXT, letter TEXT, payload_json TEXT NOT NULL, undoable INTEGER NOT NULL DEFAULT 0, undone_at INTEGER, created_at INTEGER NOT NULL, FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE);
      CREATE TABLE IF NOT EXISTS game_results (id TEXT PRIMARY KEY, room_id TEXT NOT NULL, round_id TEXT NOT NULL, winner_player_id TEXT, podium_json TEXT NOT NULL, full_standings_json TEXT NOT NULL, total_duration_ms INTEGER NOT NULL, finished_at INTEGER NOT NULL, FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE, FOREIGN KEY (round_id) REFERENCES game_rounds(id) ON DELETE CASCADE);
    `);
  }

  const d1Mock = options?.withD1Schema ? createPersistentD1Mock(d1Sqlite) : undefined;
  let instanceCreationCount = 0;

  const namespace: any = {
    idFromName(name: string) {
      return { toString: () => name, name };
    },
    get(id: any) {
      const key = id.toString();
      if (!instances.has(key)) {
        instanceCreationCount += 1;
        if (!doSqliteByRoom.has(key)) {
          doSqliteByRoom.set(key, new DatabaseSync(':memory:'));
        }
        const roomSqlite = doSqliteByRoom.get(key);
        const persistentStorage = createPersistentSqlStorage(roomSqlite);

        let gatePromise: Promise<any> = Promise.resolve();
        const state: any = {
          id,
          storage: persistentStorage,
          blockConcurrencyWhile: <T>(cb: () => Promise<T>): Promise<T> => {
            const p = gatePromise.then(async () => {
              if (options?.delayRestoreMs) {
                await new Promise((r) => setTimeout(r, options.delayRestoreMs));
              }
              return cb();
            });
            gatePromise = p.catch(() => {});
            return p;
          },
        };

        instances.set(
          key,
          new RoscoRoomDO(state, {
            ROSCO_ROOMS: namespace,
            DB: d1Mock,
          })
        );
      }

      const instance = instances.get(key)!;
      return {
        fetch: (req: Request | string, init?: RequestInit) => {
          const request = typeof req === 'string' ? new Request(req, init) : req;
          return instance.fetch(request);
        },
        alarm: () => instance.alarm(),
      };
    },
  };

  return {
    env: {
      ROSCO_ROOMS: namespace,
      DB: d1Mock,
      APP_NAME: 'PRL-ROSCO',
      MAX_CONTESTANTS: '15',
      DEFAULT_TIMER_SECONDS: '120',
    } as Env,
    d1Sqlite,
    doSqliteByRoom,
    /**
     * Simula la destrucción/evicción en memoria del Durable Object conservando intacto
     * su almacenamiento SQLite duradero para verificar la restauración en una nueva instancia.
     */
    evictInstance(roomCode: string) {
      instances.delete(roomCode.toUpperCase());
    },
    getInstanceCreationCount() {
      return instanceCreationCount;
    },
  };
}

describe('PRL-ROSCO — Pruebas de Integración de Cloudflare Worker y Durable Object RoscoRoomDO', () => {
  it('responde correctamente en /api/health con 135 preguntas en el banco', async () => {
    const harness = await createPersistentCloudflareHarness();
    const res = await workerEntry.fetch(
      new Request('https://prl-rosco.workers.dev/api/health'),
      harness.env
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.ok).toBe(true);
    expect(data.service).toBe('prl-rosco-api');
    expect(data.maxContestants).toBe(15);
    expect(data.questionBankCount).toBe(INITIAL_PRL_QUESTION_BANK.length);
  });

  it('ejecuta flujo completo en RoscoRoomDO: creación, entrada, inicio, Pasapalabra con cesión de turno y bloqueo 403', async () => {
    const harness = await createPersistentCloudflareHarness();
    const env = harness.env;

    const createRes = await workerEntry.fetch(
      new Request('https://prl-rosco.workers.dev/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customCode: 'PRL3D',
          config: { roomName: 'Aula Prevención 3D', timerSeconds: 120, pointsCorrect: 10 },
        }),
      }),
      env
    );
    const created = (await createRes.json()) as any;
    expect(created.ok).toBe(true);
    const hostToken = created.hostToken;

    const join1 = (await (
      await workerEntry.fetch(
        new Request('https://prl-rosco.workers.dev/api/rooms/PRL3D/join', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'Javier' }),
        }),
        env
      )
    ).json()) as any;

    const join2 = (await (
      await workerEntry.fetch(
        new Request('https://prl-rosco.workers.dev/api/rooms/PRL3D/join', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'Ana' }),
        }),
        env
      )
    ).json()) as any;

    const started = (await (
      await workerEntry.fetch(
        new Request('https://prl-rosco.workers.dev/api/rooms/PRL3D/action', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Auth-Token': hostToken },
          body: JSON.stringify({ type: 'START_GAME', actionId: 'do-start-1' }),
        }),
        env
      )
    ).json()) as any;
    expect(started.publicState.status).toBe('PLAYING');
    expect(started.publicState.activePlayerId).toBe(join1.playerId);

    // Concursante no recibe presenterPrivate ni puede ejecutar acciones de host
    const contestantView = (await (
      await workerEntry.fetch(
        new Request('https://prl-rosco.workers.dev/api/rooms/PRL3D/state', {
          headers: { 'X-Auth-Token': join1.playerToken },
        }),
        env
      )
    ).json()) as any;
    expect(contestantView.presenterPrivate).toBeUndefined();
    expect(contestantView.publicState.activeQuestion.mainAnswer).toBeUndefined();

    const unauthorizedRes = await workerEntry.fetch(
      new Request('https://prl-rosco.workers.dev/api/rooms/PRL3D/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Auth-Token': join1.playerToken },
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

    await workerEntry.fetch(
      new Request('https://prl-rosco.workers.dev/api/rooms/PRL3D/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Auth-Token': hostToken },
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

    const transferData = (await (
      await workerEntry.fetch(
        new Request('https://prl-rosco.workers.dev/api/rooms/PRL3D/action', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Auth-Token': hostToken },
          body: JSON.stringify({
            type: 'PASAPALABRA_DECISION',
            actionId: 'do-transfer-1',
            decision: 'TRANSFER_TURN',
            nextPlayerId: join2.playerId,
          }),
        }),
        env
      )
    ).json()) as any;
    expect(transferData.publicState.activePlayerId).toBe(join2.playerId);
    expect(transferData.publicState.activeLetter).toBe('A');
  });

  // ==========================================================================
  // PRUEBAS OBLIGATORIAS DE PERSISTENCIA SQLITE DEL DURABLE OBJECT Y RESTAURACIÓN
  // ==========================================================================
  it('persiste el estado completo en SQLite del DO, lo restaura en una nueva instancia del DO, mantiene D1 coherente, evita duplicados y permite reconexión', async () => {
    const harness = await createPersistentCloudflareHarness({
      withD1Schema: true,
      delayRestoreMs: 15,
    });
    const env = harness.env;

    // 1. Crear sala
    const createRes = await workerEntry.fetch(
      new Request('https://prl-rosco.workers.dev/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customCode: 'PERS01',
          config: { roomName: 'Sala Persistente PRL', timerSeconds: 150, pointsCorrect: 15 },
        }),
      }),
      env
    );
    const created = (await createRes.json()) as any;
    expect(created.ok).toBe(true);
    const hostToken = created.hostToken;

    // 2. Unir 3 concursantes
    const p1 = (await (
      await workerEntry.fetch(
        new Request('https://prl-rosco.workers.dev/api/rooms/PERS01/join', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'Javier' }),
        }),
        env
      )
    ).json()) as any;

    const p2 = (await (
      await workerEntry.fetch(
        new Request('https://prl-rosco.workers.dev/api/rooms/PERS01/join', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'Lucía' }),
        }),
        env
      )
    ).json()) as any;

    const p3 = (await (
      await workerEntry.fetch(
        new Request('https://prl-rosco.workers.dev/api/rooms/PERS01/join', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'Carlos' }),
        }),
        env
      )
    ).json()) as any;

    // 3. Iniciar partida, marcar A acierto, B fallo, C Pasapalabra -> continuar con mismo (D), D acierto, E Pasapalabra -> ceder turno a Lucía
    const sRes = (await (
      await workerEntry.fetch(
        new Request('https://prl-rosco.workers.dev/api/rooms/PERS01/action', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Auth-Token': hostToken },
          body: JSON.stringify({ type: 'START_GAME', actionId: 'act-start' }),
        }),
        env
      )
    ).json()) as any;

    const qA = sRes.publicState.activeQuestion.id;
    const afterA = (await (
      await workerEntry.fetch(
        new Request('https://prl-rosco.workers.dev/api/rooms/PERS01/action', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Auth-Token': hostToken },
          body: JSON.stringify({
            type: 'MARK_CORRECT',
            actionId: 'act-mark-A',
            expectedPlayerId: p1.playerId,
            expectedLetter: 'A',
            expectedQuestionId: qA,
          }),
        }),
        env
      )
    ).json()) as any;

    const qB = afterA.publicState.activeQuestion.id;
    const afterB = (await (
      await workerEntry.fetch(
        new Request('https://prl-rosco.workers.dev/api/rooms/PERS01/action', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Auth-Token': hostToken },
          body: JSON.stringify({
            type: 'MARK_INCORRECT',
            actionId: 'act-mark-B',
            expectedPlayerId: p1.playerId,
            expectedLetter: 'B',
            expectedQuestionId: qB,
          }),
        }),
        env
      )
    ).json()) as any;

    const qC = afterB.publicState.activeQuestion.id;
    await workerEntry.fetch(
      new Request('https://prl-rosco.workers.dev/api/rooms/PERS01/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Auth-Token': hostToken },
        body: JSON.stringify({
          type: 'REGISTER_PASAPALABRA',
          actionId: 'act-pasa-C',
          expectedPlayerId: p1.playerId,
          expectedLetter: 'C',
          expectedQuestionId: qC,
        }),
      }),
      env
    );

    const afterContinueC = (await (
      await workerEntry.fetch(
        new Request('https://prl-rosco.workers.dev/api/rooms/PERS01/action', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Auth-Token': hostToken },
          body: JSON.stringify({
            type: 'PASAPALABRA_DECISION',
            actionId: 'act-cont-C',
            decision: 'CONTINUE_SAME',
          }),
        }),
        env
      )
    ).json()) as any;
    expect(afterContinueC.publicState.activeLetter).toBe('D');

    // Sumar +15s al reloj de Javier y pausar partida antes de simular la evicción del DO
    await workerEntry.fetch(
      new Request('https://prl-rosco.workers.dev/api/rooms/PERS01/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Auth-Token': hostToken },
        body: JSON.stringify({
          type: 'ADD_TIME',
          actionId: 'act-addtime-p1',
          playerId: p1.playerId,
          deltaSeconds: 15,
        }),
      }),
      env
    );

    // Ceder turno a Lucía mediante Pasapalabra en D y luego marcar acierto de Lucía en A
    const afterPasaD = (await (
      await workerEntry.fetch(
        new Request('https://prl-rosco.workers.dev/api/rooms/PERS01/action', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Auth-Token': hostToken },
          body: JSON.stringify({
            type: 'REGISTER_PASAPALABRA',
            actionId: 'act-pasa-D',
            expectedPlayerId: p1.playerId,
            expectedLetter: 'D',
            expectedQuestionId: afterContinueC.publicState.activeQuestion.id,
          }),
        }),
        env
      )
    ).json()) as any;
    expect(afterPasaD.publicState.awaitingPasapalabraDecision).toBe(true);

    const afterTransfer = (await (
      await workerEntry.fetch(
        new Request('https://prl-rosco.workers.dev/api/rooms/PERS01/action', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Auth-Token': hostToken },
          body: JSON.stringify({
            type: 'PASAPALABRA_DECISION',
            actionId: 'act-transfer-lucia',
            decision: 'TRANSFER_TURN',
            nextPlayerId: p2.playerId,
          }),
        }),
        env
      )
    ).json()) as any;

    const luciaQA = afterTransfer.publicState.activeQuestion.id;
    const beforeEvict = (await (
      await workerEntry.fetch(
        new Request('https://prl-rosco.workers.dev/api/rooms/PERS01/action', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Auth-Token': hostToken },
          body: JSON.stringify({
            type: 'MARK_CORRECT',
            actionId: 'act-lucia-A',
            expectedPlayerId: p2.playerId,
            expectedLetter: 'A',
            expectedQuestionId: luciaQA,
          }),
        }),
        env
      )
    ).json()) as any;

    // Pausar partida para verificar conservación exacta de tiempo y luego expulsar a Carlos
    await workerEntry.fetch(
      new Request('https://prl-rosco.workers.dev/api/rooms/PERS01/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Auth-Token': hostToken },
        body: JSON.stringify({ type: 'KICK_CONTESTANT', actionId: 'act-kick-p3', playerId: p3.playerId }),
      }),
      env
    );

    const pausedBeforeEvict = (await (
      await workerEntry.fetch(
        new Request('https://prl-rosco.workers.dev/api/rooms/PERS01/action', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Auth-Token': hostToken },
          body: JSON.stringify({ type: 'PAUSE_GAME', actionId: 'act-pause-before-evict' }),
        }),
        env
      )
    ).json()) as any;

    const initialInstanceCount = harness.getInstanceCreationCount();
    const expectedStateVersion = pausedBeforeEvict.publicState.stateVersion;
    const expectedEventSeq = pausedBeforeEvict.publicState.eventSeq;
    const expectedJavierBefore = pausedBeforeEvict.publicState.contestants.find(
      (c: any) => c.id === p1.playerId
    );
    const expectedLuciaBefore = pausedBeforeEvict.publicState.contestants.find(
      (c: any) => c.id === p2.playerId
    );

    // Verificar tabla interna SQLite del Durable Object antes de la evicción
    const roomSqlite = harness.doSqliteByRoom.get('PERS01');
    const metaRow = roomSqlite.prepare('SELECT room_code, state_version, status FROM do_room_meta WHERE id = 1').get();
    expect(metaRow.room_code).toBe('PERS01');
    expect(metaRow.state_version).toBe(expectedStateVersion);
    expect(metaRow.status).toBe('PAUSED');

    // 4. SIMULAR REINICIO / EVICCIÓN DEL DURABLE OBJECT Y CREACIÓN DE UNA NUEVA INSTANCIA SOBRE EL MISMO SQLITE
    harness.evictInstance('PERS01');

    // Lanzar peticiones concurrentes inmediatas sobre la nueva instancia mientras blockConcurrencyWhile restaura
    const [hostRecoveredRes, contestantRecoveredRes] = await Promise.all([
      workerEntry.fetch(
        new Request('https://prl-rosco.workers.dev/api/rooms/PERS01/state', {
          headers: { 'X-Auth-Token': hostToken },
        }),
        env
      ),
      workerEntry.fetch(
        new Request('https://prl-rosco.workers.dev/api/rooms/PERS01/state', {
          headers: { 'X-Auth-Token': p1.playerToken },
        }),
        env
      ),
    ]);

    expect(harness.getInstanceCreationCount()).toBe(initialInstanceCount + 1);
    expect(hostRecoveredRes.status).toBe(200);
    expect(contestantRecoveredRes.status).toBe(200);

    const hostRecovered = (await hostRecoveredRes.json()) as any;
    const contestantRecovered = (await contestantRecoveredRes.json()) as any;

    // Comprobar recuperación del estado completo, concursante activo, letra activa y separación privada/pública
    expect(hostRecovered.publicState.roomCode).toBe('PERS01');
    expect(hostRecovered.publicState.status).toBe('PAUSED');
    expect(hostRecovered.publicState.stateVersion).toBe(expectedStateVersion);
    expect(hostRecovered.publicState.eventSeq).toBe(expectedEventSeq);
    expect(hostRecovered.publicState.activePlayerId).toBe(p2.playerId);
    expect(hostRecovered.publicState.activeLetter).toBe('B');
    expect(hostRecovered.presenterPrivate).toBeDefined();
    expect(hostRecovered.presenterPrivate.activeQuestionPrivate.mainAnswer).toBeTruthy();
    expect(Object.keys(hostRecovered.presenterPrivate.roundQuestions)).toHaveLength(27);
    expect(contestantRecovered.presenterPrivate).toBeUndefined();
    expect(contestantRecovered.publicState.activeQuestion.mainAnswer).toBeUndefined();

    // Comprobar recuperación de los 27 estados de cada rosco, puntuaciones, tiempos y preguntas pendientes
    expect(hostRecovered.publicState.contestants).toHaveLength(2); // Carlos fue expulsado antes del reinicio
    const javierAfter = hostRecovered.publicState.contestants.find((c: any) => c.id === p1.playerId);
    const luciaAfter = hostRecovered.publicState.contestants.find((c: any) => c.id === p2.playerId);

    expect(Object.keys(javierAfter.letters)).toHaveLength(27);
    expect(Object.keys(luciaAfter.letters)).toHaveLength(27);
    for (const l of ROSCO_LETTERS) {
      expect(javierAfter.letters[l].state).toBe(expectedJavierBefore.letters[l].state);
      expect(luciaAfter.letters[l].state).toBe(expectedLuciaBefore.letters[l].state);
    }
    expect(javierAfter.letters.A.state).toBe('CORRECT');
    expect(javierAfter.letters.B.state).toBe('INCORRECT');
    expect(javierAfter.letters.C.state).toBe('PASSED');
    expect(javierAfter.letters.D.state).toBe('PASSED');
    expect(javierAfter.score.totalPoints).toBe(15);
    expect(javierAfter.score.pendingCount).toBe(25);
    expect(javierAfter.timer.remainingMs).toBe(expectedJavierBefore.timer.remainingMs);
    expect(luciaAfter.letters.A.state).toBe('CORRECT');
    expect(luciaAfter.letters.B.state).toBe('ACTIVE');
    expect(luciaAfter.score.totalPoints).toBe(15);
    expect(luciaAfter.timer.remainingMs).toBe(expectedLuciaBefore.timer.remainingMs);

    // Comprobar NO duplicación de operación después de la restauración (reintento del mismo actionId)
    const replayRes = await workerEntry.fetch(
      new Request('https://prl-rosco.workers.dev/api/rooms/PERS01/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Auth-Token': hostToken },
        body: JSON.stringify({
          type: 'MARK_CORRECT',
          actionId: 'act-lucia-A',
          expectedPlayerId: p2.playerId,
          expectedLetter: 'A',
          expectedQuestionId: luciaQA,
        }),
      }),
      env
    );
    expect(replayRes.status).toBe(409);
    const replayErr = (await replayRes.json()) as any;
    expect(replayErr.code).toBe('DUPLICATE_ACTION');

    // Reanudar y verificar que Lucía NO ha duplicado puntos
    const resumed = (await (
      await workerEntry.fetch(
        new Request('https://prl-rosco.workers.dev/api/rooms/PERS01/action', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Auth-Token': hostToken },
          body: JSON.stringify({ type: 'RESUME_GAME', actionId: 'act-resume-after-evict' }),
        }),
        env
      )
    ).json()) as any;
    expect(resumed.ok).toBe(true);
    expect(
      resumed.publicState.contestants.find((c: any) => c.id === p2.playerId).score.totalPoints
    ).toBe(15);

    // Comprobar reconexión de cliente por /join con playerToken tras reinicio conservando identidad, rosco, puntuación y tiempo
    const reconnectJoin = (await (
      await workerEntry.fetch(
        new Request('https://prl-rosco.workers.dev/api/rooms/PERS01/join', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: 'Javier',
            playerToken: p1.playerToken,
          }),
        }),
        env
      )
    ).json()) as any;
    expect(reconnectJoin.ok).toBe(true);
    expect(reconnectJoin.playerId).toBe(p1.playerId);
    expect(reconnectJoin.playerToken).toBe(p1.playerToken);
    const reconnectedJavier = reconnectJoin.publicState.contestants.find(
      (c: any) => c.id === p1.playerId
    );
    expect(reconnectedJavier.score.totalPoints).toBe(15);
    expect(reconnectedJavier.letters.C.state).toBe('PASSED');

    // Comprobar reconexión WebSocket simulada tras reinicio del Durable Object
    const prevWsPair = (globalThis as any).WebSocketPair;
    const prevResponse = globalThis.Response;
    (globalThis as any).WebSocketPair = class MockWebSocketPair {
      0: FakeWebSocket;
      1: FakeWebSocket;
      constructor() {
        const client = new FakeWebSocket();
        const server = new FakeWebSocket();
        client.peer = server;
        server.peer = client;
        this[0] = client;
        this[1] = server;
      }
    };
    (globalThis as any).Response = class MockWorkerResponse extends prevResponse {
      constructor(body?: BodyInit | null, init?: any) {
        if (init?.status === 101 && init?.webSocket) {
          super(null, { status: 200, headers: init.headers });
          return Object.assign(Object.create(null), {
            status: 101,
            webSocket: init.webSocket,
            ok: true,
            headers: new Headers(init.headers),
          });
        }
        super(body, init);
      }
    };
    try {
      const wsReq = new Request(
        `https://prl-rosco.workers.dev/api/rooms/PERS01/ws?token=${encodeURIComponent(
          p1.playerToken
        )}`,
        { headers: { Upgrade: 'websocket' } }
      );
      const wsRes = await workerEntry.fetch(wsReq, env);
      expect(wsRes.status).toBe(101);
      const clientWs = (wsRes as any).webSocket as FakeWebSocket;
      expect(clientWs.receivedMessages.length).toBeGreaterThanOrEqual(1);
      const syncPayload = JSON.parse(clientWs.receivedMessages[0]);
      expect(syncPayload.type).toBe('STATE_SYNC');
      expect(syncPayload.presenterPrivate).toBeUndefined();
      expect(
        syncPayload.publicState.contestants.find((c: any) => c.id === p1.playerId).score
          .totalPoints
      ).toBe(15);

      // Reconexión también del Presentador vía WebSocket tras reinicio: recibe presenterPrivate
      const hostWsReq = new Request(
        `https://prl-rosco.workers.dev/api/rooms/PERS01/ws?token=${encodeURIComponent(
          hostToken
        )}`,
        { headers: { Upgrade: 'websocket' } }
      );
      const hostWsRes = await workerEntry.fetch(hostWsReq, env);
      expect(hostWsRes.status).toBe(101);
      const hostWs = (hostWsRes as any).webSocket as FakeWebSocket;
      expect(hostWs.receivedMessages.length).toBeGreaterThanOrEqual(1);
      const hostSyncPayload = JSON.parse(hostWs.receivedMessages[0]);
      expect(hostSyncPayload.type).toBe('STATE_SYNC');
      expect(hostSyncPayload.presenterPrivate).toBeDefined();
      expect(hostSyncPayload.presenterPrivate.activeQuestionPrivate.mainAnswer).toBeTruthy();
    } finally {
      (globalThis as any).WebSocketPair = prevWsPair;
      (globalThis as any).Response = prevResponse;
    }

    // Comprobar coherencia con las tablas históricas de D1
    const d1Room = harness.d1Sqlite
      .prepare('SELECT code, status, active_player_id, state_version FROM rooms WHERE code = ?')
      .get('PERS01');
    expect(d1Room.code).toBe('PERS01');
    expect(d1Room.active_player_id).toBe(p2.playerId);
    const d1Scores = harness.d1Sqlite
      .prepare('SELECT player_id, total_points, correct_count FROM scores WHERE room_id = ?')
      .all('room-PERS01');
    expect(d1Scores.length).toBeGreaterThanOrEqual(2);
    const d1LettersP1 = harness.d1Sqlite
      .prepare('SELECT letter, state FROM player_letter_states WHERE player_id = ?')
      .all(p1.playerId);
    expect(d1LettersP1).toHaveLength(27);
    expect(d1LettersP1.find((r: any) => r.letter === 'C').state).toBe('PASSED');
  });

  it('mantiene seguridad ante operaciones concurrentes (límite de 15 concursantes y acciones simultáneas sobre la misma letra)', async () => {
    const harness = await createPersistentCloudflareHarness();
    const env = harness.env;

    const created = (await (
      await workerEntry.fetch(
        new Request('https://prl-rosco.workers.dev/api/rooms', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ customCode: 'CONC15' }),
        }),
        env
      )
    ).json()) as any;
    const hostToken = created.hostToken;

    // Unir 13 concursantes primero
    for (let i = 1; i <= 13; i++) {
      const r = await workerEntry.fetch(
        new Request('https://prl-rosco.workers.dev/api/rooms/CONC15/join', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: `Alumno ${i}` }),
        }),
        env
      );
      expect(r.status).toBe(200);
    }

    // Lanzar 4 peticiones concurrentes de ingreso para los puestos 14 y 15 -> exactamente 2 entran y 2 son rechazadas (403)
    const raceJoins = await Promise.all([14, 15, 16, 17].map((n) =>
      workerEntry.fetch(
        new Request('https://prl-rosco.workers.dev/api/rooms/CONC15/join', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: `Alumno ${n}` }),
        }),
        env
      )
    ));

    const joinStatuses = raceJoins.map((r) => r.status).sort();
    expect(joinStatuses).toEqual([200, 200, 403, 403]);

    // Iniciar partida
    const started = (await (
      await workerEntry.fetch(
        new Request('https://prl-rosco.workers.dev/api/rooms/CONC15/action', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Auth-Token': hostToken },
          body: JSON.stringify({ type: 'START_GAME', actionId: 'conc-start' }),
        }),
        env
      )
    ).json()) as any;

    const activePlayerId = started.publicState.activePlayerId;
    const qA = started.publicState.activeQuestion.id;

    // Lanzar 2 acciones concurrentes distintas apuntando a la misma letra A -> exactamente 1 triunfa (200) y 1 es rechazada (409)
    const [res1, res2] = await Promise.all([
      workerEntry.fetch(
        new Request('https://prl-rosco.workers.dev/api/rooms/CONC15/action', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Auth-Token': hostToken },
          body: JSON.stringify({
            type: 'MARK_CORRECT',
            actionId: 'race-act-1',
            expectedPlayerId: activePlayerId,
            expectedLetter: 'A',
            expectedQuestionId: qA,
          }),
        }),
        env
      ),
      workerEntry.fetch(
        new Request('https://prl-rosco.workers.dev/api/rooms/CONC15/action', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Auth-Token': hostToken },
          body: JSON.stringify({
            type: 'MARK_INCORRECT',
            actionId: 'race-act-2',
            expectedPlayerId: activePlayerId,
            expectedLetter: 'A',
            expectedQuestionId: qA,
          }),
        }),
        env
      ),
    ]);

    const actionStatuses = [res1.status, res2.status].sort();
    expect(actionStatuses).toEqual([200, 409]);

    // Evictar y verificar que tras restaurar el estado concurrente sigue consistente con exactamente 15 jugadores y 1 letra cerrada
    harness.evictInstance('CONC15');
    const finalState = (await (
      await workerEntry.fetch(
        new Request('https://prl-rosco.workers.dev/api/rooms/CONC15/state', {
          headers: { 'X-Auth-Token': hostToken },
        }),
        env
      )
    ).json()) as any;
    expect(finalState.publicState.contestants).toHaveLength(15);
    expect(finalState.publicState.activeLetter).toBe('B');
  });
});
