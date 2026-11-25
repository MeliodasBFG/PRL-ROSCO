import {
  AuthoritativeRoscoRoom,
  PersistedRoscoRoomSnapshot,
  RoscoSecurityError,
} from '../shared/roscoGameEngine';
import {
  GameEventType,
  PresenterActionPayload,
  PRLQuestion,
  ROSCO_LETTERS,
  RoomConfig,
  ServerToClientMessage,
} from '../shared/types';

// ============================================================================
// CLOUDFLARE DURABLE OBJECT: RoscoRoomDO (CON PERSISTENCIA SQLITE ATÓMICA)
// Mantiene el estado autoritativo en almacenamiento SQLite duradero del DO,
// cronómetros individuales por marcas temporales del servidor, WebSockets
// hibernables/reconectables y coherencia histórica con D1.
// ============================================================================

export interface Env {
  DB?: D1Database;
  ROSCO_ROOMS: DurableObjectNamespace;
  ENVIRONMENT?: string;
  APP_NAME?: string;
  MAX_CONTESTANTS?: string;
  DEFAULT_TIMER_SECONDS?: string;
}

interface SocketSessionAttachment {
  role: 'HOST' | 'CONTESTANT';
  token: string;
  playerId: string | null;
}

const DO_META_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS do_room_meta (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    room_id TEXT NOT NULL,
    room_code TEXT NOT NULL,
    state_version INTEGER NOT NULL,
    event_seq INTEGER NOT NULL,
    status TEXT NOT NULL,
    active_player_id TEXT,
    active_letter TEXT,
    snapshot_json TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
`;

const DO_PROCESSED_ACTIONS_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS do_processed_actions (
    action_id TEXT PRIMARY KEY,
    event_type TEXT NOT NULL,
    state_version INTEGER NOT NULL,
    processed_at INTEGER NOT NULL
  );
`;

const KV_FALLBACK_SNAPSHOT_KEY = 'rosco_room_snapshot_v1';

export class RoscoRoomDO implements DurableObject {
  private state: DurableObjectState;
  private env: Env;
  private room: AuthoritativeRoscoRoom | null = null;
  private sessions: Map<WebSocket, SocketSessionAttachment> = new Map();
  private readonly readyPromise: Promise<void>;
  private mutationQueue: Promise<void> = Promise.resolve();
  private alarmTickCount = 0;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;

    // Inicialización segura: bloquea peticiones concurrentes hasta restaurar el estado SQLite
    const initTask = () => this.restoreFromDurableStorage();
    this.readyPromise =
      typeof this.state.blockConcurrencyWhile === 'function'
        ? this.state.blockConcurrencyWhile(initTask)
        : initTask();
  }

  private async ensureReady(): Promise<void> {
    await this.readyPromise;
  }

  /**
   * Serializa todas las mutaciones dentro del Durable Object para evitar condiciones de carrera,
   * lecturas sucias o escrituras parciales ante peticiones concurrentes (HTTP, WS y alarmas).
   */
  private runSerialized<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.mutationQueue.then(fn, fn);
    this.mutationQueue = next.then(
      () => undefined,
      () => undefined
    );
    return next;
  }

  // ==========================================================================
  // PERSISTENCIA SQLITE DEL DURABLE OBJECT Y RESTAURACIÓN ATÓMICA
  // ==========================================================================

  private hasSqliteStorage(): boolean {
    return Boolean(this.state.storage && (this.state.storage as any).sql);
  }

  private runInTransactionSync<T>(closure: () => T): T {
    if (typeof this.state.storage?.transactionSync === 'function') {
      return this.state.storage.transactionSync(closure);
    }
    return closure();
  }

  private ensureSqliteSchema(): void {
    if (!this.hasSqliteStorage()) return;
    const sql = this.state.storage.sql;
    this.runInTransactionSync(() => {
      sql.exec(DO_META_TABLE_SQL);
      sql.exec(DO_PROCESSED_ACTIONS_TABLE_SQL);
    });
  }

  private async restoreFromDurableStorage(): Promise<void> {
    let snapshot: PersistedRoscoRoomSnapshot | null = null;
    const extraActionIds: string[] = [];

    if (this.hasSqliteStorage()) {
      this.ensureSqliteSchema();
      const sql = this.state.storage.sql;
      const rows = sql
        .exec<{ snapshot_json: string }>('SELECT snapshot_json FROM do_room_meta WHERE id = 1')
        .toArray();
      if (rows.length > 0 && typeof rows[0].snapshot_json === 'string') {
        snapshot = JSON.parse(rows[0].snapshot_json) as PersistedRoscoRoomSnapshot;
      }

      const actionRows = sql
        .exec<{ action_id: string }>('SELECT action_id FROM do_processed_actions')
        .toArray();
      for (const row of actionRows) {
        if (row.action_id) {
          extraActionIds.push(row.action_id);
        }
      }
    } else if (typeof this.state.storage?.get === 'function') {
      const saved = await this.state.storage.get<PersistedRoscoRoomSnapshot>(
        KV_FALLBACK_SNAPSHOT_KEY
      );
      if (saved) {
        snapshot = saved;
      }
    }

    if (snapshot) {
      const restored = AuthoritativeRoscoRoom.fromSnapshot(snapshot);
      restored.recordProcessedActions(extraActionIds);
      this.room = restored;
    }
  }

  /**
   * Persiste atómicamente el estado completo de la sala en el SQLite del Durable Object.
   * Garantiza ausencia de escrituras parciales mediante transactionSync.
   */
  private async persistToDurableStorage(
    actionMeta?: { actionId: string; eventType: GameEventType },
    now = Date.now()
  ): Promise<void> {
    if (!this.room) return;
    const snapshot = this.room.serializeSnapshot(now);

    if (this.hasSqliteStorage()) {
      const sql = this.state.storage.sql;
      const snapshotJson = JSON.stringify(snapshot);
      this.runInTransactionSync(() => {
        sql.exec(DO_META_TABLE_SQL);
        sql.exec(DO_PROCESSED_ACTIONS_TABLE_SQL);
        sql.exec(
          `INSERT INTO do_room_meta (
            id, room_id, room_code, state_version, event_seq, status,
            active_player_id, active_letter, snapshot_json, updated_at
          ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            room_id = excluded.room_id,
            room_code = excluded.room_code,
            state_version = excluded.state_version,
            event_seq = excluded.event_seq,
            status = excluded.status,
            active_player_id = excluded.active_player_id,
            active_letter = excluded.active_letter,
            snapshot_json = excluded.snapshot_json,
            updated_at = excluded.updated_at`,
          snapshot.roomId,
          snapshot.roomCode,
          snapshot.stateVersion,
          snapshot.eventSeq,
          snapshot.status,
          snapshot.activePlayerId,
          snapshot.activeLetter,
          snapshotJson,
          now
        );

        if (actionMeta?.actionId) {
          sql.exec(
            `INSERT OR IGNORE INTO do_processed_actions (
              action_id, event_type, state_version, processed_at
            ) VALUES (?, ?, ?, ?)`,
            actionMeta.actionId,
            actionMeta.eventType,
            snapshot.stateVersion,
            now
          );

          // Mantener acotada la tabla histórica de idempotencia a las 1000 acciones más recientes
          sql.exec(
            `DELETE FROM do_processed_actions
             WHERE action_id NOT IN (
               SELECT action_id FROM do_processed_actions ORDER BY processed_at DESC LIMIT 1000
             )`
          );
        }
      });
    } else if (typeof this.state.storage?.put === 'function') {
      await this.state.storage.put(KV_FALLBACK_SNAPSHOT_KEY, snapshot);
    }
  }

  /**
   * Ejecuta una mutación sobre `this.room` con copia de seguridad previa y persistencia
   * atómica inmediata; si falla el almacenamiento duradero, revierte el estado en memoria.
   */
  private async commitRoomMutation<T>(
    mutator: (room: AuthoritativeRoscoRoom) => { result: T; actionMeta?: { actionId: string; eventType: GameEventType }; shouldPersist?: boolean }
  ): Promise<T> {
    if (!this.room) {
      throw new RoscoSecurityError(
        'ROOM_NOT_FOUND',
        'La sala solicitada no existe o ha expirado.',
        404
      );
    }

    const preSnapshot = this.room.serializeSnapshot();
    try {
      const outcome = mutator(this.room);
      if (outcome.shouldPersist !== false) {
        await this.persistToDurableStorage(outcome.actionMeta);
      }
      return outcome.result;
    } catch (err) {
      this.room = AuthoritativeRoscoRoom.fromSnapshot(preSnapshot);
      throw err;
    }
  }

  // ==========================================================================
  // ENRUTAMIENTO HTTP Y WEBSOCKETS
  // ==========================================================================

  public async fetch(request: Request): Promise<Response> {
    await this.ensureReady();

    const url = new URL(request.url);
    const path = url.pathname;

    try {
      // 1. Conexión WebSocket en tiempo real (inicial y reconexiones tras reinicio)
      if (request.headers.get('Upgrade')?.toLowerCase() === 'websocket') {
        return this.handleWebSocketUpgrade(request, url);
      }

      // 2. Creación / inicialización de la sala en este Durable Object
      if (path.endsWith('/init') && request.method === 'POST') {
        const body = (await request.json()) as {
          roomId: string;
          roomCode: string;
          hostToken: string;
          config?: Partial<RoomConfig>;
          questionBank?: PRLQuestion[];
        };

        return await this.runSerialized(async () => {
          const previousRoom = this.room;
          try {
            this.room = new AuthoritativeRoscoRoom({
              roomId: body.roomId,
              roomCode: body.roomCode,
              hostToken: body.hostToken,
              config: body.config,
              questionBank: body.questionBank,
            });

            await this.persistToDurableStorage();
            await this.syncFullStateToD1();
            await this.scheduleNextAlarmIfNeeded();

            return Response.json({
              ok: true,
              publicState: this.room.getPublicState(),
              presenterPrivate: this.room.getPresenterPrivateState(body.hostToken),
            });
          } catch (err) {
            this.room = previousRoom;
            throw err;
          }
        });
      }

      if (!this.room) {
        return Response.json(
          {
            ok: false,
            code: 'ROOM_NOT_FOUND',
            message: 'La sala solicitada no existe o ha expirado.',
          },
          { status: 404 }
        );
      }

      // 3. Entrada o reconexión de concursante (máximo 15 concursantes)
      if (path.endsWith('/join') && request.method === 'POST') {
        const body = (await request.json()) as {
          name: string;
          avatar?: Record<string, unknown>;
          playerToken?: string;
        };

        return await this.runSerialized(async () => {
          const joined = await this.commitRoomMutation((room) => {
            room.syncActiveTimer();
            const res = room.joinContestant({
              name: body.name,
              avatar: body.avatar as any,
              playerToken: body.playerToken,
            });
            return { result: res };
          });

          await this.syncFullStateToD1();
          this.broadcastStateSync(joined.isReconnection ? 'PLAYER_RECONNECTED' : 'PLAYER_JOINED');

          return Response.json({
            ok: true,
            playerId: joined.playerId,
            playerToken: joined.playerToken,
            publicState: this.room!.getPublicState(),
          });
        });
      }

      // 4. Obtener estado actual de la sala (público o de presentador si adjunta hostToken válido)
      if (path.endsWith('/state') && request.method === 'GET') {
        const token = request.headers.get('X-Auth-Token') || url.searchParams.get('token');
        const { expiredPlayerId } = await this.runSerialized(async () => {
          const syncRes = this.room!.syncActiveTimer();
          if (syncRes.expiredPlayerId) {
            await this.persistToDurableStorage();
          }
          return syncRes;
        });

        if (expiredPlayerId) {
          await this.syncFullStateToD1();
          this.broadcastStateSync('TIMER_EXPIRED');
        }

        const publicState = this.room.getPublicState();
        const presenterPrivate = this.room.isHostToken(token)
          ? this.room.getPresenterPrivateState(token)
          : undefined;

        return Response.json({
          ok: true,
          publicState,
          presenterPrivate,
        });
      }

      // 5. Ejecutar acción exclusiva del presentador (HTTP POST)
      if (path.endsWith('/action') && request.method === 'POST') {
        const token = request.headers.get('X-Auth-Token');
        const payload = (await request.json()) as PresenterActionPayload;

        return await this.runSerialized(async () => {
          const eventType = await this.commitRoomMutation((room) => {
            const evt = room.executePresenterAction(token, payload);
            return {
              result: evt,
              actionMeta: { actionId: payload.actionId, eventType: evt },
            };
          });

          await this.scheduleNextAlarmIfNeeded();
          await this.syncFullStateToD1();
          this.broadcastStateSync(eventType);

          return Response.json({
            ok: true,
            event: eventType,
            publicState: this.room!.getPublicState(),
            presenterPrivate: this.room!.getPresenterPrivateState(token),
          });
        });
      }

      // 6. Consultar y editar el banco de preguntas de PRL (solo presentador)
      if (path.endsWith('/questions') && request.method === 'GET') {
        const token = request.headers.get('X-Auth-Token') || url.searchParams.get('token');
        this.room.verifyHostToken(token);
        return Response.json({
          ok: true,
          questions: this.room.getQuestionBank(),
        });
      }

      if (path.endsWith('/questions') && request.method === 'POST') {
        const token = request.headers.get('X-Auth-Token');
        const question = (await request.json()) as PRLQuestion;

        return await this.runSerialized(async () => {
          const saved = await this.commitRoomMutation((room) => {
            const q = room.upsertQuestionInBank(token, question);
            return { result: q };
          });

          await this.syncFullStateToD1();
          this.broadcastStateSync('QUESTION_ACTIVATED');
          return Response.json({
            ok: true,
            question: saved,
          });
        });
      }

      // 7. Consultar historial de rondas finalizadas
      if (path.endsWith('/results') && request.method === 'GET') {
        return Response.json({
          ok: true,
          results: this.room.pastResults,
        });
      }

      return Response.json({ ok: false, message: 'Ruta no encontrada en RoscoRoomDO' }, { status: 404 });
    } catch (err) {
      if (err instanceof RoscoSecurityError) {
        return Response.json(
          { ok: false, code: err.code, message: err.message },
          { status: err.httpStatus }
        );
      }
      const message = err instanceof Error ? err.message : 'Error interno del servidor';
      return Response.json({ ok: false, code: 'INTERNAL_ERROR', message }, { status: 500 });
    }
  }

  // ==========================================================================
  // ALARMAS DEL DURABLE OBJECT PARA EL CRONÓMETRO AUTORITATIVO Y PERSISTENCIA
  // ==========================================================================

  public async alarm(): Promise<void> {
    await this.ensureReady();
    if (!this.room) return;

    await this.runSerialized(async () => {
      if (!this.room) return;
      const now = Date.now();
      const { expiredPlayerId } = await this.commitRoomMutation((room) => {
        const syncRes = room.syncActiveTimer(now);
        this.alarmTickCount += 1;
        // Persistir siempre al expirar el tiempo y periódicamente cada 5 segundos durante juego activo
        const shouldPersist = Boolean(syncRes.expiredPlayerId) || this.alarmTickCount % 5 === 0;
        return { result: syncRes, shouldPersist };
      });

      if (expiredPlayerId) {
        await this.syncFullStateToD1();
        this.broadcastStateSync('TIMER_EXPIRED');
        return;
      }

      if (this.room.status === 'PLAYING' && this.room.activePlayerId) {
        const active = this.room
          .getPublicState(now)
          .contestants.find((c) => c.id === this.room!.activePlayerId);
        if (active && active.timer.isRunning) {
          const tickMsg: ServerToClientMessage = {
            type: 'TIMER_TICK',
            activePlayerId: active.id,
            remainingMs: active.timer.remainingMs,
            consumedMs: active.timer.consumedMs,
            isRunning: active.timer.isRunning,
            serverTimestamp: now,
          };
          this.broadcastRaw(JSON.stringify(tickMsg));
          await this.scheduleNextAlarmIfNeeded();
        }
      }
    });
  }

  private async scheduleNextAlarmIfNeeded(): Promise<void> {
    if (!this.room || this.room.status !== 'PLAYING' || !this.room.activePlayerId) return;
    if (typeof this.state.storage?.setAlarm === 'function') {
      await this.state.storage.setAlarm(Date.now() + 1000);
    }
  }

  // ==========================================================================
  // WEBSOCKETS (SOPORTE HIBERNABLE Y RECONEXIÓN SEGURA TRAS REINICIO DEL DO)
  // ==========================================================================

  private supportsHibernation(): boolean {
    return (
      typeof this.state.acceptWebSocket === 'function' &&
      typeof this.state.getWebSockets === 'function'
    );
  }

  private getConnectedSessions(): Array<{ ws: WebSocket; session: SocketSessionAttachment }> {
    const result: Array<{ ws: WebSocket; session: SocketSessionAttachment }> = [];
    if (this.supportsHibernation()) {
      for (const ws of this.state.getWebSockets()) {
        const att = (ws as any).deserializeAttachment?.() as SocketSessionAttachment | null;
        if (att) {
          result.push({ ws, session: att });
        }
      }
      // Si hubiera sesiones en el mapa local (por ejemplo en pruebas), combinarlas sin duplicar
      for (const [ws, session] of this.sessions.entries()) {
        if (!result.some((item) => item.ws === ws)) {
          result.push({ ws, session });
        }
      }
      return result;
    }

    for (const [ws, session] of this.sessions.entries()) {
      result.push({ ws, session });
    }
    return result;
  }

  private async handleWebSocketUpgrade(request: Request, url: URL): Promise<Response> {
    if (!this.room) {
      return new Response('Sala no encontrada', { status: 404 });
    }

    const token = url.searchParams.get('token') || '';
    const isHost = this.room.isHostToken(token);
    const playerId = isHost ? null : this.room.getPlayerIdByToken(token);

    if (!isHost && !playerId) {
      return new Response('Token de sesión no válido', { status: 403 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    const session: SocketSessionAttachment = {
      role: isHost ? 'HOST' : 'CONTESTANT',
      token,
      playerId,
    };

    if (this.supportsHibernation()) {
      this.state.acceptWebSocket(server, [
        session.role,
        session.playerId ? `player:${session.playerId}` : 'host',
      ]);
      (server as any).serializeAttachment?.(session);
    } else {
      server.accept();
      this.sessions.set(server, session);
    }

    let connectionStateChanged = false;
    await this.runSerialized(async () => {
      if (!this.room) return;
      await this.commitRoomMutation((room) => {
        room.syncActiveTimer();
        if (isHost) {
          if (!room.hostConnected) {
            room.hostConnected = true;
            connectionStateChanged = true;
          }
        } else if (playerId) {
          connectionStateChanged = room.setContestantConnection(playerId, true);
        }
        return { result: undefined, shouldPersist: connectionStateChanged };
      });
      if (connectionStateChanged) {
        await this.syncFullStateToD1();
      }
    });

    // Enviar estado autoritativo completo al cliente que conecta o reconecta
    const initialMsg: ServerToClientMessage = {
      type: 'STATE_SYNC',
      event: playerId ? 'PLAYER_RECONNECTED' : 'ROOM_CREATED',
      publicState: this.room.getPublicState(),
      presenterPrivate: isHost ? this.room.getPresenterPrivateState(token) : undefined,
    };
    server.send(JSON.stringify(initialMsg));

    if (playerId && connectionStateChanged) {
      this.broadcastStateSync('PLAYER_RECONNECTED');
    }

    if (!this.supportsHibernation()) {
      server.addEventListener('message', (event) => {
        void this.processWebSocketMessage(server, session, event.data);
      });
      const onCloseOrError = () => {
        void this.processWebSocketDisconnect(server, session);
      };
      server.addEventListener('close', onCloseOrError);
      server.addEventListener('error', onCloseOrError);
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  public async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    await this.ensureReady();
    const session = (ws as any).deserializeAttachment?.() as SocketSessionAttachment | null;
    if (!session) return;
    await this.processWebSocketMessage(ws, session, message);
  }

  public async webSocketClose(ws: WebSocket): Promise<void> {
    await this.ensureReady();
    const session =
      ((ws as any).deserializeAttachment?.() as SocketSessionAttachment | null) ??
      this.sessions.get(ws) ??
      null;
    if (!session) return;
    await this.processWebSocketDisconnect(ws, session);
  }

  public async webSocketError(ws: WebSocket): Promise<void> {
    await this.webSocketClose(ws);
  }

  private async processWebSocketMessage(
    ws: WebSocket,
    session: SocketSessionAttachment,
    rawData: string | ArrayBuffer
  ): Promise<void> {
    try {
      if (!this.room) return;
      const text =
        typeof rawData === 'string' ? rawData : new TextDecoder().decode(rawData);
      const data = JSON.parse(text);

      if (data.type === 'PING') {
        const { expiredPlayerId } = await this.runSerialized(async () => {
          const res = this.room!.syncActiveTimer();
          if (res.expiredPlayerId) {
            await this.persistToDurableStorage();
          }
          return res;
        });

        if (expiredPlayerId) {
          await this.syncFullStateToD1();
          this.broadcastStateSync('TIMER_EXPIRED');
          return;
        }

        const active = this.room
          .getPublicState()
          .contestants.find((c) => c.id === this.room!.activePlayerId);
        ws.send(
          JSON.stringify({
            type: 'TIMER_TICK',
            activePlayerId: this.room.activePlayerId,
            remainingMs: active?.timer.remainingMs ?? 0,
            consumedMs: active?.timer.consumedMs ?? 0,
            isRunning: active?.timer.isRunning ?? false,
            serverTimestamp: Date.now(),
          } satisfies ServerToClientMessage)
        );
        return;
      }

      if (data.type === 'PRESENTER_ACTION') {
        const payload = data.payload as PresenterActionPayload;
        await this.runSerialized(async () => {
          const evt = await this.commitRoomMutation((room) => {
            const eventType = room.executePresenterAction(session.token, payload);
            return {
              result: eventType,
              actionMeta: { actionId: payload.actionId, eventType },
            };
          });
          await this.scheduleNextAlarmIfNeeded();
          await this.syncFullStateToD1();
          this.broadcastStateSync(evt);
        });
      }
    } catch (err) {
      const errMsg: ServerToClientMessage = {
        type: 'ERROR',
        code: err instanceof RoscoSecurityError ? err.code : 'WS_ACTION_ERROR',
        message: err instanceof Error ? err.message : 'Error al procesar acción',
      };
      try {
        ws.send(JSON.stringify(errMsg));
      } catch {
        // Ignorar si el socket ya cerró
      }
    }
  }

  private async processWebSocketDisconnect(
    ws: WebSocket,
    session: SocketSessionAttachment
  ): Promise<void> {
    this.sessions.delete(ws);
    if (!this.room) return;

    await this.runSerialized(async () => {
      if (!this.room) return;
      const remaining = this.getConnectedSessions().filter((item) => item.ws !== ws);

      if (session.role === 'HOST') {
        const anyHostLeft = remaining.some((item) => item.session.role === 'HOST');
        if (!anyHostLeft && this.room.hostConnected) {
          await this.commitRoomMutation((room) => {
            room.hostConnected = false;
            return { result: undefined, shouldPersist: true };
          });
          await this.syncFullStateToD1();
        }
      } else if (session.playerId) {
        const anySamePlayerLeft = remaining.some(
          (item) => item.session.playerId === session.playerId
        );
        if (!anySamePlayerLeft) {
          const changed = await this.commitRoomMutation((room) => {
            const didChange = room.setContestantConnection(session.playerId!, false);
            return { result: didChange, shouldPersist: didChange };
          });
          if (changed) {
            await this.syncFullStateToD1();
            this.broadcastStateSync('PLAYER_LEFT');
          }
        }
      }
    });
  }

  private broadcastStateSync(event: GameEventType): void {
    if (!this.room) return;
    const publicState = this.room.getPublicState();

    for (const { ws, session } of this.getConnectedSessions()) {
      try {
        const msg: ServerToClientMessage = {
          type: 'STATE_SYNC',
          event,
          publicState,
          presenterPrivate:
            session.role === 'HOST'
              ? this.room.getPresenterPrivateState(session.token)
              : undefined,
        };
        ws.send(JSON.stringify(msg));
      } catch {
        this.sessions.delete(ws);
      }
    }
  }

  private broadcastRaw(serialized: string): void {
    for (const { ws } of this.getConnectedSessions()) {
      try {
        ws.send(serialized);
      } catch {
        this.sessions.delete(ws);
      }
    }
  }

  // ==========================================================================
  // COHERENCIA COMPLETA CON BASE DE DATOS HISTÓRICA CLOUDFLARE D1
  // ==========================================================================

  private async syncFullStateToD1(): Promise<void> {
    if (!this.env.DB || !this.room) return;
    try {
      const db = this.env.DB;
      const pub = this.room.getPublicState();
      const roundId = `${pub.roomId}-r${pub.roundNumber}`;
      const roundQuestions = this.room.getRoundQuestions();
      const allContestants = this.room.getAllContestantsSnapshot();
      const auditEvents = this.room.getAuditLog();
      const now = Date.now();

      const statements: D1PreparedStatement[] = [];

      // 1. Sala (rooms) — usar ON CONFLICT DO UPDATE para no disparar ON DELETE CASCADE
      statements.push(
        db
          .prepare(
            `INSERT INTO rooms (
              id, code, name, is_public, host_token_hash, status, timer_seconds,
              points_correct, points_incorrect, points_pasapalabra, show_leaderboard,
              selected_categories, selected_difficulty, active_player_id, current_round_id,
              state_version, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              name = excluded.name,
              is_public = excluded.is_public,
              status = excluded.status,
              timer_seconds = excluded.timer_seconds,
              points_correct = excluded.points_correct,
              points_incorrect = excluded.points_incorrect,
              points_pasapalabra = excluded.points_pasapalabra,
              show_leaderboard = excluded.show_leaderboard,
              selected_categories = excluded.selected_categories,
              selected_difficulty = excluded.selected_difficulty,
              active_player_id = excluded.active_player_id,
              current_round_id = excluded.current_round_id,
              state_version = excluded.state_version,
              updated_at = excluded.updated_at`
          )
          .bind(
            pub.roomId,
            pub.roomCode,
            pub.config.roomName,
            pub.config.isPublic ? 1 : 0,
            'sha256-protected',
            pub.status,
            pub.config.timerSeconds,
            pub.config.pointsCorrect,
            pub.config.pointsIncorrect,
            pub.config.pointsPasapalabra,
            pub.config.showLeaderboardDuringGame ? 1 : 0,
            JSON.stringify(pub.config.selectedCategories),
            pub.config.selectedDifficulty,
            pub.activePlayerId,
            roundId,
            pub.stateVersion,
            this.room.roundStartedAt,
            now
          )
      );

      // 2. Ronda actual (game_rounds)
      statements.push(
        db
          .prepare(
            `INSERT INTO game_rounds (id, room_id, round_number, status, started_at, finished_at)
             VALUES (?, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET
               status = excluded.status,
               finished_at = excluded.finished_at`
          )
          .bind(
            roundId,
            pub.roomId,
            pub.roundNumber,
            pub.status === 'FINISHED' ? 'FINISHED' : 'IN_PROGRESS',
            this.room.roundStartedAt,
            pub.status === 'FINISHED' ? now : null
          )
      );

      // 3. Asegurar preguntas de la ronda en `questions` y registrar `round_questions`
      ROSCO_LETTERS.forEach((letter, idx) => {
        const q = roundQuestions[letter];
        if (!q) return;
        statements.push(
          db
            .prepare(
              `INSERT INTO questions (
                id, letter, mode, statement, main_answer, accepted_variants, synonyms,
                explanation, category, difficulty, source, source_url, reviewed_at, is_active
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
              ON CONFLICT(id) DO UPDATE SET
                statement = excluded.statement,
                main_answer = excluded.main_answer,
                accepted_variants = excluded.accepted_variants,
                synonyms = excluded.synonyms,
                explanation = excluded.explanation,
                category = excluded.category,
                difficulty = excluded.difficulty,
                source = excluded.source,
                source_url = excluded.source_url,
                reviewed_at = excluded.reviewed_at`
            )
            .bind(
              q.id,
              q.letter,
              q.mode,
              q.statement,
              q.mainAnswer,
              JSON.stringify(q.acceptedVariants),
              JSON.stringify(q.synonyms),
              q.explanation,
              q.category,
              q.difficulty,
              q.source,
              q.sourceUrl,
              q.reviewedAt
            )
        );

        statements.push(
          db
            .prepare(
              `INSERT INTO round_questions (id, round_id, room_id, letter, question_id, display_order)
               VALUES (?, ?, ?, ?, ?, ?)
               ON CONFLICT(round_id, letter) DO UPDATE SET
                 question_id = excluded.question_id,
                 display_order = excluded.display_order`
            )
            .bind(`${roundId}-${letter}`, roundId, pub.roomId, letter, q.id, idx + 1)
        );
      });

      // 4. Concursantes, sesiones, roscos, 27 letras, cronómetros y puntuaciones
      for (const c of allContestants) {
        const roscoId = `${roundId}-${c.id}`;
        const pToken = this.room.getPlayerToken(c.id);

        statements.push(
          db
            .prepare(
              `INSERT INTO players (
                id, room_id, name, avatar_config, turn_order, status, is_connected, created_at, updated_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(id) DO UPDATE SET
                name = excluded.name,
                avatar_config = excluded.avatar_config,
                turn_order = excluded.turn_order,
                status = excluded.status,
                is_connected = excluded.is_connected,
                updated_at = excluded.updated_at`
            )
            .bind(
              c.id,
              pub.roomId,
              c.name,
              JSON.stringify(c.avatar),
              c.turnOrder,
              c.status,
              c.isConnected ? 1 : 0,
              now,
              now
            )
        );

        if (pToken) {
          statements.push(
            db
              .prepare(
                `INSERT INTO player_sessions (
                  token_hash, room_id, player_id, role, created_at, last_seen_at, revoked
                ) VALUES (?, ?, ?, 'CONTESTANT', ?, ?, ?)
                ON CONFLICT(token_hash) DO UPDATE SET
                  last_seen_at = excluded.last_seen_at,
                  revoked = excluded.revoked`
              )
              .bind(pToken, pub.roomId, c.id, now, now, c.status === 'KICKED' ? 1 : 0)
          );
        }

        statements.push(
          db
            .prepare(
              `INSERT INTO player_roscos (
                id, round_id, room_id, player_id, current_letter, lap_count, status, started_at, finished_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(round_id, player_id) DO UPDATE SET
                current_letter = excluded.current_letter,
                lap_count = excluded.lap_count,
                status = excluded.status,
                finished_at = excluded.finished_at`
            )
            .bind(
              roscoId,
              roundId,
              pub.roomId,
              c.id,
              c.currentLetter,
              c.lapCount,
              c.status === 'FINISHED' ? 'FINISHED' : 'IN_PROGRESS',
              this.room.roundStartedAt,
              c.status === 'FINISHED' ? now : null
            )
        );

        for (const letter of ROSCO_LETTERS) {
          const lp = c.letters[letter];
          if (!lp) continue;
          statements.push(
            db
              .prepare(
                `INSERT INTO player_letter_states (
                  id, rosco_id, room_id, player_id, letter, question_id, state,
                  presentation_order, attempts, result, points_earned, answered_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(rosco_id, letter) DO UPDATE SET
                  question_id = excluded.question_id,
                  state = excluded.state,
                  attempts = excluded.attempts,
                  result = excluded.result,
                  points_earned = excluded.points_earned,
                  answered_at = excluded.answered_at`
              )
              .bind(
                `${roscoId}-${letter}`,
                roscoId,
                pub.roomId,
                c.id,
                letter,
                lp.questionId,
                lp.state,
                lp.presentationOrder,
                lp.attempts,
                lp.result,
                lp.pointsEarned,
                lp.answeredAt
              )
          );
        }

        statements.push(
          db
            .prepare(
              `INSERT INTO player_timers (
                player_id, room_id, round_id, initial_ms, remaining_ms, consumed_ms,
                is_running, last_started_at, updated_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(round_id, player_id) DO UPDATE SET
                initial_ms = excluded.initial_ms,
                remaining_ms = excluded.remaining_ms,
                consumed_ms = excluded.consumed_ms,
                is_running = excluded.is_running,
                last_started_at = excluded.last_started_at,
                updated_at = excluded.updated_at`
            )
            .bind(
              c.id,
              pub.roomId,
              roundId,
              c.timer.initialMs,
              c.timer.remainingMs,
              c.timer.consumedMs,
              c.timer.isRunning ? 1 : 0,
              c.timer.lastServerSyncAt,
              now
            )
        );

        statements.push(
          db
            .prepare(
              `INSERT INTO scores (
                player_id, room_id, round_id, correct_count, incorrect_count,
                pasapalabra_count, pending_count, total_points, time_consumed_ms,
                time_remaining_ms, accuracy_pct, rank_position, updated_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(round_id, player_id) DO UPDATE SET
                correct_count = excluded.correct_count,
                incorrect_count = excluded.incorrect_count,
                pasapalabra_count = excluded.pasapalabra_count,
                pending_count = excluded.pending_count,
                total_points = excluded.total_points,
                time_consumed_ms = excluded.time_consumed_ms,
                time_remaining_ms = excluded.time_remaining_ms,
                accuracy_pct = excluded.accuracy_pct,
                rank_position = excluded.rank_position,
                updated_at = excluded.updated_at`
            )
            .bind(
              c.id,
              pub.roomId,
              roundId,
              c.score.correctCount,
              c.score.incorrectCount,
              c.score.pasapalabraCount,
              c.score.pendingCount,
              c.score.totalPoints,
              c.score.timeConsumedMs,
              c.score.timeRemainingMs,
              c.score.accuracyPct,
              c.score.rankPosition,
              now
            )
        );
      }

      // 5. Registro de auditoría de eventos (game_events)
      for (const evt of auditEvents.slice(0, 25)) {
        statements.push(
          db
            .prepare(
              `INSERT INTO game_events (
                id, room_id, round_id, seq, event_type, actor_role, target_player_id,
                letter, payload_json, undoable, undone_at, created_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(id) DO UPDATE SET
                undone_at = excluded.undone_at,
                undoable = excluded.undoable`
            )
            .bind(
              `${pub.roomId}-${evt.id}`,
              pub.roomId,
              roundId,
              evt.seq,
              evt.eventType,
              evt.actorRole,
              evt.targetPlayerId,
              evt.letter,
              JSON.stringify({ description: evt.description }),
              evt.undoable ? 1 : 0,
              evt.undoneAt,
              evt.timestamp
            )
        );
      }

      // 6. Resultados históricos finales (game_results)
      for (const res of this.room.pastResults.slice(0, 5)) {
        const resRoundId = `${pub.roomId}-r${res.roundNumber}`;
        statements.push(
          db
            .prepare(
              `INSERT INTO game_results (
                id, room_id, round_id, winner_player_id, podium_json,
                full_standings_json, total_duration_ms, finished_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(id) DO UPDATE SET
                winner_player_id = excluded.winner_player_id,
                podium_json = excluded.podium_json,
                full_standings_json = excluded.full_standings_json,
                finished_at = excluded.finished_at`
            )
            .bind(
              res.id,
              res.roomId,
              resRoundId,
              res.winnerPlayerId,
              JSON.stringify(res.podium),
              JSON.stringify(res.standings),
              Math.max(0, res.finishedAt - this.room.roundStartedAt),
              res.finishedAt
            )
        );
      }

      for (let i = 0; i < statements.length; i += 100) {
        await db.batch(statements.slice(i, i + 100));
      }
    } catch {
      // En modo local sin migración D1 previa aplicada no interrumpe el Durable Object SQLite
    }
  }
}
