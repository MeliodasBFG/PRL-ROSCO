import {
  AuthoritativeRoscoRoom,
  RoscoSecurityError,
} from '../shared/roscoGameEngine';
import {
  PresenterActionPayload,
  PRLQuestion,
  RoomConfig,
  ServerToClientMessage,
} from '../shared/types';

// ============================================================================
// CLOUDFLARE DURABLE OBJECT: RoscoRoomDO
// Mantiene el estado autoritativo, cronómetros individuales y conexiones WebSocket
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

export class RoscoRoomDO implements DurableObject {
  private state: DurableObjectState;
  private env: Env;
  private room: AuthoritativeRoscoRoom | null = null;
  private sessions: Map<WebSocket, SocketSessionAttachment> = new Map();

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }

  public async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    try {
      // 1. Conexión WebSocket en tiempo real
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

        this.room = new AuthoritativeRoscoRoom({
          roomId: body.roomId,
          roomCode: body.roomCode,
          hostToken: body.hostToken,
          config: body.config,
          questionBank: body.questionBank,
        });

        await this.persistRoomSnapshotToD1();
        await this.scheduleNextAlarmIfNeeded();

        return Response.json({
          ok: true,
          publicState: this.room.getPublicState(),
          presenterPrivate: this.room.getPresenterPrivateState(body.hostToken),
        });
      }

      if (!this.room) {
        return Response.json(
          { ok: false, code: 'ROOM_NOT_FOUND', message: 'La sala solicitada no existe o ha expirado.' },
          { status: 404 }
        );
      }

      // 3. Entrada de concursante (máximo 15 concursantes)
      if (path.endsWith('/join') && request.method === 'POST') {
        const body = (await request.json()) as {
          name: string;
          avatar?: Record<string, unknown>;
          playerToken?: string;
        };

        const joined = this.room.joinContestant({
          name: body.name,
          avatar: body.avatar as any,
          playerToken: body.playerToken,
        });

        await this.persistPlayerToD1(joined.contestant, joined.playerToken);
        this.broadcastStateSync('PLAYER_JOINED');

        return Response.json({
          ok: true,
          playerId: joined.playerId,
          playerToken: joined.playerToken,
          publicState: this.room.getPublicState(),
        });
      }

      // 4. Obtener estado actual de la sala (público o de presentador si adjunta hostToken válido)
      if (path.endsWith('/state') && request.method === 'GET') {
        this.room.syncActiveTimer();
        const token = request.headers.get('X-Auth-Token') || url.searchParams.get('token');
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

      // 5. Ejecutar acción exclusiva del presentador (HTTP POST o vía WebSocket)
      if (path.endsWith('/action') && request.method === 'POST') {
        const token = request.headers.get('X-Auth-Token');
        const payload = (await request.json()) as PresenterActionPayload;

        const eventType = this.room.executePresenterAction(token, payload);
        await this.scheduleNextAlarmIfNeeded();
        await this.persistRoomSnapshotToD1();
        this.broadcastStateSync(eventType);

        return Response.json({
          ok: true,
          event: eventType,
          publicState: this.room.getPublicState(),
          presenterPrivate: this.room.getPresenterPrivateState(token),
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
        const saved = this.room.upsertQuestionInBank(token, question);
        await this.persistQuestionToD1(saved);
        this.broadcastStateSync('QUESTION_ACTIVATED');
        return Response.json({
          ok: true,
          question: saved,
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
  // ALARMAS DEL DURABLE OBJECT PARA EL CRONÓMETRO AUTORITATIVO
  // ==========================================================================

  public async alarm(): Promise<void> {
    if (!this.room) return;
    const { expiredPlayerId } = this.room.syncActiveTimer(Date.now());

    if (expiredPlayerId) {
      await this.persistRoomSnapshotToD1();
      this.broadcastStateSync('TIMER_EXPIRED');
    } else if (this.room.status === 'PLAYING' && this.room.activePlayerId) {
      const active = this.room
        .getPublicState()
        .contestants.find((c) => c.id === this.room!.activePlayerId);
      if (active && active.timer.isRunning) {
        const tickMsg: ServerToClientMessage = {
          type: 'TIMER_TICK',
          activePlayerId: active.id,
          remainingMs: active.timer.remainingMs,
          consumedMs: active.timer.consumedMs,
          isRunning: active.timer.isRunning,
          serverTimestamp: Date.now(),
        };
        this.broadcastRaw(JSON.stringify(tickMsg));
        await this.scheduleNextAlarmIfNeeded();
      }
    }
  }

  private async scheduleNextAlarmIfNeeded(): Promise<void> {
    if (!this.room || this.room.status !== 'PLAYING' || !this.room.activePlayerId) return;
    await this.state.storage.setAlarm(Date.now() + 1000);
  }

  // ==========================================================================
  // GESTIÓN DE WEBSOCKETS Y DIFUSIÓN CON SEPARACIÓN DE PERMISOS
  // ==========================================================================

  private handleWebSocketUpgrade(request: Request, url: URL): Response {
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

    server.accept();
    const session: SocketSessionAttachment = {
      role: isHost ? 'HOST' : 'CONTESTANT',
      token,
      playerId,
    };
    this.sessions.set(server, session);

    if (isHost) {
      this.room.hostConnected = true;
    } else if (playerId) {
      this.room.setContestantConnection(playerId, true);
    }

    // Enviar estado completo inicial inmediatamente al conectar/reconectar
    this.room.syncActiveTimer();
    const initialMsg: ServerToClientMessage = {
      type: 'STATE_SYNC',
      event: playerId ? 'PLAYER_RECONNECTED' : 'ROOM_CREATED',
      publicState: this.room.getPublicState(),
      presenterPrivate: isHost ? this.room.getPresenterPrivateState(token) : undefined,
    };
    server.send(JSON.stringify(initialMsg));

    if (playerId) {
      this.broadcastStateSync('PLAYER_RECONNECTED');
    }

    server.addEventListener('message', async (event) => {
      try {
        if (!this.room) return;
        const data = JSON.parse(String(event.data));
        if (data.type === 'PING') {
          this.room.syncActiveTimer();
          server.send(
            JSON.stringify({
              type: 'TIMER_TICK',
              activePlayerId: this.room.activePlayerId,
              remainingMs:
                this.room
                  .getPublicState()
                  .contestants.find((c) => c.id === this.room!.activePlayerId)?.timer.remainingMs ?? 0,
              consumedMs:
                this.room
                  .getPublicState()
                  .contestants.find((c) => c.id === this.room!.activePlayerId)?.timer.consumedMs ?? 0,
              isRunning:
                this.room
                  .getPublicState()
                  .contestants.find((c) => c.id === this.room!.activePlayerId)?.timer.isRunning ?? false,
              serverTimestamp: Date.now(),
            } satisfies ServerToClientMessage)
          );
          return;
        }

        if (data.type === 'PRESENTER_ACTION') {
          const evt = this.room.executePresenterAction(session.token, data.payload);
          await this.scheduleNextAlarmIfNeeded();
          await this.persistRoomSnapshotToD1();
          this.broadcastStateSync(evt);
        }
      } catch (err) {
        const errMsg: ServerToClientMessage = {
          type: 'ERROR',
          code: err instanceof RoscoSecurityError ? err.code : 'WS_ACTION_ERROR',
          message: err instanceof Error ? err.message : 'Error al procesar acción',
        };
        server.send(JSON.stringify(errMsg));
      }
    });

    const handleClose = () => {
      this.sessions.delete(server);
      if (!this.room) return;
      if (session.role === 'HOST') {
        const anyHostLeft = Array.from(this.sessions.values()).some((s) => s.role === 'HOST');
        this.room.hostConnected = anyHostLeft;
      } else if (session.playerId) {
        const anySamePlayerLeft = Array.from(this.sessions.values()).some(
          (s) => s.playerId === session.playerId
        );
        if (!anySamePlayerLeft) {
          this.room.setContestantConnection(session.playerId, false);
          this.broadcastStateSync('PLAYER_LEFT');
        }
      }
    };

    server.addEventListener('close', handleClose);
    server.addEventListener('error', handleClose);

    return new Response(null, { status: 101, webSocket: client });
  }

  private broadcastStateSync(event: any): void {
    if (!this.room) return;
    const publicState = this.room.getPublicState();

    for (const [ws, session] of this.sessions.entries()) {
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
    for (const ws of this.sessions.keys()) {
      try {
        ws.send(serialized);
      } catch {
        this.sessions.delete(ws);
      }
    }
  }

  // ==========================================================================
  // PERSISTENCIA EN BASE DE DATOS CLOUDFLARE D1 (SI EL BINDING ESTÁ ACTIVO)
  // ==========================================================================

  private async persistRoomSnapshotToD1(): Promise<void> {
    if (!this.env.DB || !this.room) return;
    try {
      const pub = this.room.getPublicState();
      const now = Date.now();
      await this.env.DB.prepare(
        `INSERT INTO rooms (
          id, code, name, is_public, host_token_hash, status, timer_seconds,
          points_correct, points_incorrect, points_pasapalabra, show_leaderboard,
          selected_categories, selected_difficulty, active_player_id, state_version,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          status = excluded.status,
          timer_seconds = excluded.timer_seconds,
          points_correct = excluded.points_correct,
          show_leaderboard = excluded.show_leaderboard,
          active_player_id = excluded.active_player_id,
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
          pub.stateVersion,
          now,
          now
        )
        .run();
    } catch {
      // En modo local sin migración D1 previa aplicada no interrumpe el Durable Object
    }
  }

  private async persistPlayerToD1(contestant: any, token: string): Promise<void> {
    if (!this.env.DB || !this.room) return;
    try {
      const now = Date.now();
      await this.env.DB.prepare(
        `INSERT OR REPLACE INTO players (
          id, room_id, name, avatar_config, turn_order, status, is_connected, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
        .bind(
          contestant.id,
          this.room.roomId,
          contestant.name,
          JSON.stringify(contestant.avatar),
          contestant.turnOrder,
          contestant.status,
          contestant.isConnected ? 1 : 0,
          now,
          now
        )
        .run();

      await this.env.DB.prepare(
        `INSERT OR REPLACE INTO player_sessions (
          token_hash, room_id, player_id, role, created_at, last_seen_at, revoked
        ) VALUES (?, ?, ?, 'CONTESTANT', ?, ?, 0)`
      )
        .bind(token, this.room.roomId, contestant.id, now, now)
        .run();
    } catch {
      // Continuar
    }
  }

  private async persistQuestionToD1(q: PRLQuestion): Promise<void> {
    if (!this.env.DB) return;
    try {
      await this.env.DB.prepare(
        `INSERT OR REPLACE INTO questions (
          id, letter, mode, statement, main_answer, accepted_variants, synonyms,
          explanation, category, difficulty, source, source_url, reviewed_at, is_active
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`
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
        .run();
    } catch {
      // Continuar
    }
  }
}
