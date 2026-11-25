import {
  INITIAL_PRL_QUESTION_BANK,
  normalizeSpanishText,
  selectRoundQuestions,
  toPublicQuestionView,
} from './prlQuestionBank';
import {
  AuditEvent,
  AvatarConfig,
  CameraShot,
  CharacterAnimationState,
  ContestantState,
  DEFAULT_AVATAR_CONFIGS,
  DEFAULT_TIMER_SECONDS,
  GameEventType,
  LetterState,
  MAX_CONTESTANTS,
  PlayerLetterProgress,
  PlayerScoreState,
  PlayerTimerState,
  PresenterActionPayload,
  PresenterPrivateState,
  PRLCategory,
  PRLQuestion,
  ROSCO_LETTERS,
  RoscoLetter,
  RoomConfig,
  RoomPublicState,
  RoomStatus,
} from './types';

// ============================================================================
// MOTOR AUTORITATIVO DE SALA PRL-ROSCO (SERVIDOR / DURABLE OBJECT)
// ============================================================================

export class RoscoSecurityError extends Error {
  public readonly code: string;
  public readonly httpStatus: number;

  constructor(code: string, message: string, httpStatus = 403) {
    super(message);
    this.name = 'RoscoSecurityError';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

interface UndoSnapshot {
  status: RoomStatus;
  activePlayerId: string | null;
  activeLetter: RoscoLetter | null;
  awaitingPasapalabraDecision: boolean;
  revealedAnswerForQuestionId: string | null;
  revealedExplanationForQuestionId: string | null;
  characterAnimation: CharacterAnimationState;
  cameraShot: CameraShot;
  contestantsJson: string;
  actionDescription: string;
  auditEventId: string;
}

export interface PastRoundResult {
  id: string;
  roomId: string;
  roomCode: string;
  roundNumber: number;
  winnerPlayerId: string | null;
  winnerName: string | null;
  podium: Array<{
    rank: number;
    playerId: string;
    name: string;
    avatar: AvatarConfig;
    score: PlayerScoreState;
  }>;
  standings: Array<{
    rank: number;
    playerId: string;
    name: string;
    score: PlayerScoreState;
  }>;
  finishedAt: number;
}

export interface PersistedRoscoRoomSnapshot {
  schemaVersion: 1;
  roomId: string;
  roomCode: string;
  hostToken: string;
  playerTokenEntries: Array<[string, string]>;
  processedActionIds: string[];
  status: RoomStatus;
  roundNumber: number;
  roundStartedAt: number;
  stateVersion: number;
  eventSeq: number;
  hostConnected: boolean;
  config: RoomConfig;
  activePlayerId: string | null;
  activeLetter: RoscoLetter | null;
  awaitingPasapalabraDecision: boolean;
  characterAnimation: CharacterAnimationState;
  cameraShot: CameraShot;
  revealedAnswerForQuestionId: string | null;
  revealedExplanationForQuestionId: string | null;
  contestants: ContestantState[];
  roundQuestions: Record<RoscoLetter, PRLQuestion>;
  previouslyUsedQuestionIds: string[];
  customQuestionBank: PRLQuestion[];
  auditLog: AuditEvent[];
  lastUndoSnapshot: UndoSnapshot | null;
  lastEvent: RoomPublicState['lastEvent'];
  timerLastTickTimestamp: number;
  pastResults: PastRoundResult[];
  savedAt: number;
}

export class AuthoritativeRoscoRoom {
  public readonly roomId: string;
  public readonly roomCode: string;
  private readonly hostToken: string;
  private readonly playerTokens: Map<string, string> = new Map(); // playerId -> token
  private readonly tokenToPlayerId: Map<string, string> = new Map(); // token -> playerId
  private readonly processedActionIds: Set<string> = new Set();

  public status: RoomStatus = 'WAITING';
  public roundNumber = 1;
  public roundStartedAt: number;
  public stateVersion = 1;
  public eventSeq = 0;
  public hostConnected = true;
  public config: RoomConfig;

  public activePlayerId: string | null = null;
  public activeLetter: RoscoLetter | null = null;
  public awaitingPasapalabraDecision = false;
  public characterAnimation: CharacterAnimationState = 'WAIT';
  public cameraShot: CameraShot = 'CONTESTANT_ENTRY';

  private revealedAnswerForQuestionId: string | null = null;
  private revealedExplanationForQuestionId: string | null = null;

  private contestants: Map<string, ContestantState> = new Map();
  private roundQuestions: Record<RoscoLetter, PRLQuestion>;
  private previouslyUsedQuestionIds: Set<string> = new Set();
  private customQuestionBank: PRLQuestion[];

  private auditLog: AuditEvent[] = [];
  private lastUndoSnapshot: UndoSnapshot | null = null;
  private lastEvent: RoomPublicState['lastEvent'] = null;
  private timerLastTickTimestamp: number = Date.now();
  public pastResults: PastRoundResult[] = [];

  constructor(params: {
    roomId: string;
    roomCode: string;
    hostToken: string;
    config?: Partial<RoomConfig>;
    questionBank?: PRLQuestion[];
    now?: number;
    _skipInitialSetup?: boolean;
  }) {
    const now = params.now ?? Date.now();
    this.roomId = params.roomId;
    this.roomCode = params.roomCode.toUpperCase();
    this.hostToken = params.hostToken;
    this.roundStartedAt = now;
    this.timerLastTickTimestamp = now;
    this.customQuestionBank = params.questionBank
      ? [...params.questionBank]
      : [...INITIAL_PRL_QUESTION_BANK];

    this.config = {
      roomName: params.config?.roomName || `Concurso PRL-ROSCO #${this.roomCode}`,
      isPublic: params.config?.isPublic ?? false,
      timerSeconds: params.config?.timerSeconds ?? DEFAULT_TIMER_SECONDS,
      pointsCorrect: params.config?.pointsCorrect ?? 10,
      pointsIncorrect: params.config?.pointsIncorrect ?? 0,
      pointsPasapalabra: params.config?.pointsPasapalabra ?? 0,
      showLeaderboardDuringGame: params.config?.showLeaderboardDuringGame ?? true,
      selectedCategories: params.config?.selectedCategories ?? [],
      selectedDifficulty: params.config?.selectedDifficulty ?? 'TODAS',
    };

    if (params._skipInitialSetup) {
      this.roundQuestions = {} as Record<RoscoLetter, PRLQuestion>;
      return;
    }

    this.roundQuestions = selectRoundQuestions({
      bank: this.customQuestionBank,
      categories: this.config.selectedCategories,
      difficulty: this.config.selectedDifficulty,
      previouslyUsedIds: this.previouslyUsedQuestionIds,
    });

    this.recordEvent(
      'ROOM_CREATED',
      'HOST',
      null,
      null,
      `Sala ${this.roomCode} creada por el presentador`,
      false,
      now
    );
  }

  // ==========================================================================
  // SERIALIZACIÓN Y RESTAURACIÓN COMPLETA DEL ESTADO AUTORITATIVO
  // ==========================================================================

  public serializeSnapshot(now = Date.now()): PersistedRoscoRoomSnapshot {
    return {
      schemaVersion: 1,
      roomId: this.roomId,
      roomCode: this.roomCode,
      hostToken: this.hostToken,
      playerTokenEntries: Array.from(this.playerTokens.entries()),
      processedActionIds: Array.from(this.processedActionIds),
      status: this.status,
      roundNumber: this.roundNumber,
      roundStartedAt: this.roundStartedAt,
      stateVersion: this.stateVersion,
      eventSeq: this.eventSeq,
      hostConnected: this.hostConnected,
      config: JSON.parse(JSON.stringify(this.config)),
      activePlayerId: this.activePlayerId,
      activeLetter: this.activeLetter,
      awaitingPasapalabraDecision: this.awaitingPasapalabraDecision,
      characterAnimation: this.characterAnimation,
      cameraShot: this.cameraShot,
      revealedAnswerForQuestionId: this.revealedAnswerForQuestionId,
      revealedExplanationForQuestionId: this.revealedExplanationForQuestionId,
      contestants: JSON.parse(JSON.stringify(Array.from(this.contestants.values()))),
      roundQuestions: JSON.parse(JSON.stringify(this.roundQuestions)),
      previouslyUsedQuestionIds: Array.from(this.previouslyUsedQuestionIds),
      customQuestionBank: JSON.parse(JSON.stringify(this.customQuestionBank)),
      auditLog: JSON.parse(JSON.stringify(this.auditLog)),
      lastUndoSnapshot: this.lastUndoSnapshot
        ? JSON.parse(JSON.stringify(this.lastUndoSnapshot))
        : null,
      lastEvent: this.lastEvent ? JSON.parse(JSON.stringify(this.lastEvent)) : null,
      timerLastTickTimestamp: this.timerLastTickTimestamp,
      pastResults: JSON.parse(JSON.stringify(this.pastResults)),
      savedAt: now,
    };
  }

  public static fromSnapshot(snapshot: PersistedRoscoRoomSnapshot): AuthoritativeRoscoRoom {
    const room = new AuthoritativeRoscoRoom({
      roomId: snapshot.roomId,
      roomCode: snapshot.roomCode,
      hostToken: snapshot.hostToken,
      config: snapshot.config,
      questionBank: snapshot.customQuestionBank,
      now: snapshot.roundStartedAt,
      _skipInitialSetup: true,
    });

    room.status = snapshot.status;
    room.roundNumber = snapshot.roundNumber;
    room.roundStartedAt = snapshot.roundStartedAt ?? snapshot.savedAt ?? Date.now();
    room.stateVersion = snapshot.stateVersion;
    room.eventSeq = snapshot.eventSeq;
    room.hostConnected = snapshot.hostConnected;
    room.config = JSON.parse(JSON.stringify(snapshot.config));
    room.activePlayerId = snapshot.activePlayerId;
    room.activeLetter = snapshot.activeLetter;
    room.awaitingPasapalabraDecision = snapshot.awaitingPasapalabraDecision;
    room.characterAnimation = snapshot.characterAnimation;
    room.cameraShot = snapshot.cameraShot;
    room.revealedAnswerForQuestionId = snapshot.revealedAnswerForQuestionId;
    room.revealedExplanationForQuestionId = snapshot.revealedExplanationForQuestionId;

    room.playerTokens.clear();
    room.tokenToPlayerId.clear();
    for (const [playerId, token] of snapshot.playerTokenEntries || []) {
      room.playerTokens.set(playerId, token);
      room.tokenToPlayerId.set(token, playerId);
    }

    room.processedActionIds.clear();
    for (const actionId of snapshot.processedActionIds || []) {
      room.processedActionIds.add(actionId);
    }

    room.contestants.clear();
    for (const c of snapshot.contestants || []) {
      room.contestants.set(c.id, JSON.parse(JSON.stringify(c)));
    }

    room.roundQuestions = JSON.parse(JSON.stringify(snapshot.roundQuestions));
    room.previouslyUsedQuestionIds = new Set(snapshot.previouslyUsedQuestionIds || []);
    room.customQuestionBank = JSON.parse(JSON.stringify(snapshot.customQuestionBank || []));
    room.auditLog = JSON.parse(JSON.stringify(snapshot.auditLog || []));
    room.lastUndoSnapshot = snapshot.lastUndoSnapshot
      ? JSON.parse(JSON.stringify(snapshot.lastUndoSnapshot))
      : null;
    room.lastEvent = snapshot.lastEvent ? JSON.parse(JSON.stringify(snapshot.lastEvent)) : null;
    room.timerLastTickTimestamp = snapshot.timerLastTickTimestamp;
    room.pastResults = JSON.parse(JSON.stringify(snapshot.pastResults || []));

    return room;
  }

  public recordProcessedActions(actionIds: string[]): void {
    for (const id of actionIds) {
      if (id) {
        this.processedActionIds.add(id);
      }
    }
  }

  public getPlayerToken(playerId: string): string | null {
    return this.playerTokens.get(playerId) ?? null;
  }

  public getAllContestantsSnapshot(): ContestantState[] {
    return Array.from(this.contestants.values()).map((c) => JSON.parse(JSON.stringify(c)));
  }

  public getRoundQuestions(): Record<RoscoLetter, PRLQuestion> {
    return { ...this.roundQuestions };
  }

  public getAuditLog(): AuditEvent[] {
    return [...this.auditLog];
  }

  // ==========================================================================
  // AUTENTICACIÓN Y SEGURIDAD DE TOKENS
  // ==========================================================================

  public verifyHostToken(token: string | null | undefined): void {
    if (!token || token !== this.hostToken) {
      throw new RoscoSecurityError(
        'UNAUTHORIZED_HOST',
        'Acceso denegado: solo el presentador autenticado puede ejecutar acciones de control.',
        403
      );
    }
  }

  public isHostToken(token: string | null | undefined): boolean {
    return Boolean(token && token === this.hostToken);
  }

  public getPlayerIdByToken(token: string | null | undefined): string | null {
    if (!token) return null;
    return this.tokenToPlayerId.get(token) ?? null;
  }

  private checkIdempotency(actionId: string): void {
    if (!actionId || typeof actionId !== 'string') {
      throw new RoscoSecurityError('INVALID_ACTION_ID', 'Se requiere un actionId válido para idempotencia.', 400);
    }
    if (this.processedActionIds.has(actionId)) {
      throw new RoscoSecurityError('DUPLICATE_ACTION', 'Esta acción ya fue procesada (protección anti-doble clic).', 409);
    }
    this.processedActionIds.add(actionId);
    if (this.processedActionIds.size > 1000) {
      const first = this.processedActionIds.values().next().value;
      if (first) this.processedActionIds.delete(first);
    }
  }

  // ==========================================================================
  // ENTRADA, RECONEXIÓN Y GESTIÓN DE HASTA 15 CONCURSANTES
  // ==========================================================================

  public joinContestant(params: {
    name: string;
    avatar?: Partial<AvatarConfig>;
    playerId?: string;
    playerToken?: string;
    now?: number;
  }): { playerId: string; playerToken: string; contestant: ContestantState; isReconnection: boolean } {
    const now = params.now ?? Date.now();
    const cleanName = params.name.trim();

    if (!cleanName || cleanName.length < 2 || cleanName.length > 28) {
      throw new RoscoSecurityError(
        'INVALID_NAME',
        'El nombre del concursante debe tener entre 2 y 28 caracteres.',
        400
      );
    }

    // 1. Verificar si es una reconexión con token válido existente
    if (params.playerToken && this.tokenToPlayerId.has(params.playerToken)) {
      const existingId = this.tokenToPlayerId.get(params.playerToken)!;
      const existing = this.contestants.get(existingId);
      if (existing && existing.status !== 'KICKED') {
        existing.isConnected = true;
        if (existing.status === 'DISCONNECTED') {
          existing.status =
            this.status === 'WAITING'
              ? 'WAITING'
              : this.activePlayerId === existing.id
              ? 'ACTIVE'
              : 'PAUSED';
        }
        this.recordEvent(
          'PLAYER_RECONNECTED',
          'CONTESTANT',
          existing.id,
          null,
          `${existing.name} se ha reconectado conservando su rosco y tiempo`,
          false,
          now
        );
        return {
          playerId: existing.id,
          playerToken: params.playerToken,
          contestant: existing,
          isReconnection: true,
        };
      }
    }

    // 2. Comprobar límite estricto de 15 concursantes activos/no expulsados
    const activeContestants = this.getActiveContestantList();
    if (activeContestants.length >= MAX_CONTESTANTS) {
      throw new RoscoSecurityError(
        'MAX_PLAYERS_REACHED',
        `La sala ha alcanzado el límite máximo de ${MAX_CONTESTANTS} concursantes.`,
        403
      );
    }

    // 3. Impedir nombres duplicados en la misma sala
    const normalizedRequested = normalizeSpanishText(cleanName);
    for (const c of activeContestants) {
      if (normalizeSpanishText(c.name) === normalizedRequested) {
        throw new RoscoSecurityError(
          'DUPLICATE_PLAYER_NAME',
          `El nombre "${cleanName}" ya está en uso en esta sala. Elige otro nombre o alias.`,
          409
        );
      }
    }

    const playerId = params.playerId || `player-${crypto.randomUUID().slice(0, 8)}`;
    const playerToken = params.playerToken || `ptok_${crypto.randomUUID().replace(/-/g, '')}`;
    const presetAvatar = DEFAULT_AVATAR_CONFIGS[activeContestants.length % DEFAULT_AVATAR_CONFIGS.length];

    const avatar: AvatarConfig = {
      ...presetAvatar,
      ...params.avatar,
      id: params.avatar?.id || presetAvatar.id,
    };

    const initialMs = this.config.timerSeconds * 1000;
    const letters = this.createInitialLettersForPlayer();

    const contestant: ContestantState = {
      id: playerId,
      name: cleanName,
      avatar,
      turnOrder: activeContestants.length + 1,
      status: 'WAITING',
      isConnected: true,
      currentLetter: 'A',
      lapCount: 1,
      letters,
      timer: {
        playerId,
        initialMs,
        remainingMs: initialMs,
        consumedMs: 0,
        isRunning: false,
        lastServerSyncAt: now,
      },
      score: {
        playerId,
        correctCount: 0,
        incorrectCount: 0,
        pasapalabraCount: 0,
        pendingCount: 27,
        totalPoints: 0,
        timeConsumedMs: 0,
        timeRemainingMs: initialMs,
        accuracyPct: 0,
        rankPosition: activeContestants.length + 1,
      },
    };

    this.contestants.set(playerId, contestant);
    this.playerTokens.set(playerId, playerToken);
    this.tokenToPlayerId.set(playerToken, playerId);
    this.recalculateLeaderboard();

    this.recordEvent(
      'PLAYER_JOINED',
      'CONTESTANT',
      playerId,
      null,
      `${cleanName} se ha unido al concurso (${activeContestants.length + 1}/${MAX_CONTESTANTS})`,
      false,
      now
    );

    return { playerId, playerToken, contestant, isReconnection: false };
  }

  public setContestantConnection(playerId: string, connected: boolean, now = Date.now()): boolean {
    const player = this.contestants.get(playerId);
    if (!player || player.status === 'KICKED') return false;

    const wasConnected = player.isConnected;
    const pausedTimerOnDisconnect = !connected && this.activePlayerId === playerId && player.timer.isRunning;

    player.isConnected = connected;
    if (!connected) {
      // Si el jugador activo pierde conexión, pausamos su cronómetro para que no pierda segundos injustamente
      if (pausedTimerOnDisconnect) {
        this.syncActiveTimer(now);
        player.timer.isRunning = false;
      }
      if (wasConnected || pausedTimerOnDisconnect) {
        this.recordEvent(
          'PLAYER_LEFT',
          'CONTESTANT',
          playerId,
          null,
          `${player.name} se ha desconectado temporalmente (su rosco y tiempo están a salvo)`,
          false,
          now
        );
      }
      return wasConnected || pausedTimerOnDisconnect;
    } else {
      if (player.status === 'DISCONNECTED') {
        player.status =
          this.status === 'WAITING'
            ? 'WAITING'
            : this.activePlayerId === player.id
            ? 'ACTIVE'
            : 'PAUSED';
      }
      if (!wasConnected) {
        this.recordEvent(
          'PLAYER_RECONNECTED',
          'CONTESTANT',
          playerId,
          null,
          `${player.name} ha recuperado su conexión`,
          false,
          now
        );
        return true;
      }
      return false;
    }
  }

  // ==========================================================================
  // CRONÓMETRO INDIVIDUAL AUTORITATIVO DEL SERVIDOR
  // ==========================================================================

  /**
   * Actualiza de forma autoritativa el cronómetro del jugador activo usando el delta real del servidor.
   * Devuelve true si el tiempo del jugador activo acaba de agotarse en este tick.
   */
  public syncActiveTimer(now = Date.now()): { expiredPlayerId: string | null } {
    const deltaMs = Math.max(0, now - this.timerLastTickTimestamp);
    this.timerLastTickTimestamp = now;

    if (this.status !== 'PLAYING' || !this.activePlayerId) {
      return { expiredPlayerId: null };
    }

    const activePlayer = this.contestants.get(this.activePlayerId);
    if (!activePlayer || !activePlayer.timer.isRunning) {
      return { expiredPlayerId: null };
    }

    activePlayer.timer.remainingMs = Math.max(0, activePlayer.timer.remainingMs - deltaMs);
    activePlayer.timer.consumedMs = activePlayer.timer.initialMs - activePlayer.timer.remainingMs;
    activePlayer.timer.lastServerSyncAt = now;

    activePlayer.score.timeRemainingMs = activePlayer.timer.remainingMs;
    activePlayer.score.timeConsumedMs = activePlayer.timer.consumedMs;

    if (activePlayer.timer.remainingMs <= 0) {
      activePlayer.timer.remainingMs = 0;
      activePlayer.timer.isRunning = false;
      this.handlePlayerTimeExpired(activePlayer, now);
      return { expiredPlayerId: activePlayer.id };
    }

    return { expiredPlayerId: null };
  }

  private handlePlayerTimeExpired(player: ContestantState, now: number): void {
    // Si tenía una letra ACTIVE, pasa a PASSED (pendiente al agotar tiempo)
    if (this.activeLetter && player.letters[this.activeLetter]?.state === 'ACTIVE') {
      player.letters[this.activeLetter].state = 'PASSED';
    }
    player.status = 'FINISHED';
    this.awaitingPasapalabraDecision = false;
    this.characterAnimation = 'ROSCO_COMPLETE';
    this.cameraShot = 'TURN_END';
    this.recalculatePlayerScore(player);
    this.recalculateLeaderboard();

    this.recordEvent(
      'TIMER_EXPIRED',
      'SYSTEM',
      player.id,
      this.activeLetter,
      `¡Tiempo agotado para ${player.name}! Su turno ha finalizado.`,
      false,
      now
    );

    this.recordEvent(
      'PLAYER_FINISHED',
      'SYSTEM',
      player.id,
      null,
      `${player.name} ha finalizado su rosco con ${player.score.correctCount} aciertos y ${player.score.totalPoints} puntos.`,
      false,
      now
    );

    this.checkIfAllContestantsFinished(now);
  }

  // ==========================================================================
  // EJECUCIÓN DE ACCIONES EXCLUSIVAS DEL PRESENTADOR
  // ==========================================================================

  public executePresenterAction(
    hostToken: string | null | undefined,
    payload: PresenterActionPayload,
    now = Date.now()
  ): GameEventType {
    // 1. Validar token de presentador en el servidor
    this.verifyHostToken(hostToken);

    // 2. Validar idempotencia (evitar doble clic y duplicados WS/HTTP)
    this.checkIdempotency(payload.actionId);

    // 3. Sincronizar cronómetro autoritativo antes de aplicar cualquier transición
    this.syncActiveTimer(now);

    switch (payload.type) {
      case 'UPDATE_CONFIG':
        return this.handleUpdateConfig(payload.config, now);

      case 'REORDER_PLAYERS':
        return this.handleReorderPlayers(payload.orderedPlayerIds, now);

      case 'START_GAME':
        return this.handleStartGame(now);

      case 'SELECT_CONTESTANT':
        return this.handleSelectContestant(payload.playerId, now);

      case 'SKIP_ABSENT_CONTESTANT':
        return this.handleSkipAbsentContestant(payload.playerId, now);

      case 'KICK_CONTESTANT':
        return this.handleKickContestant(payload.playerId, now);

      case 'MARK_CORRECT':
        return this.handleMarkAnswer(
          'CORRECT',
          payload.expectedPlayerId,
          payload.expectedLetter,
          payload.expectedQuestionId,
          now
        );

      case 'MARK_INCORRECT':
        return this.handleMarkAnswer(
          'INCORRECT',
          payload.expectedPlayerId,
          payload.expectedLetter,
          payload.expectedQuestionId,
          now
        );

      case 'REGISTER_PASAPALABRA':
        return this.handleRegisterPasapalabra(
          payload.expectedPlayerId,
          payload.expectedLetter,
          payload.expectedQuestionId,
          now
        );

      case 'PASAPALABRA_DECISION':
        return this.handlePasapalabraDecision(payload.decision, payload.nextPlayerId, now);

      case 'NEXT_LETTER':
        return this.handleNextLetter(now);

      case 'REPEAT_QUESTION':
        return this.handleRepeatQuestion(now);

      case 'REVEAL_ANSWER':
        return this.handleRevealAnswer(now);

      case 'SHOW_EXPLANATION':
        return this.handleShowExplanation(now);

      case 'PAUSE_GAME':
        return this.handlePauseGame(now);

      case 'RESUME_GAME':
        return this.handleResumeGame(now);

      case 'PAUSE_TIMER':
        return this.handlePausePersonalTimer(now);

      case 'RESUME_TIMER':
        return this.handleResumePersonalTimer(now);

      case 'ADD_TIME':
        return this.handleAddTime(payload.playerId, payload.deltaSeconds, now);

      case 'FINISH_PLAYER_TURN':
        return this.handleFinishPlayerTurn(payload.playerId, now);

      case 'FINISH_GAME':
        return this.handleFinishGame(now);

      case 'TOGGLE_LEADERBOARD':
        this.config.showLeaderboardDuringGame = payload.visible;
        return this.recordEvent(
          'LEADERBOARD_UPDATED',
          'HOST',
          null,
          null,
          payload.visible
            ? 'El presentador ha mostrado la clasificación a los participantes'
            : 'El presentador ha ocultado la clasificación temporalmente',
          false,
          now
        );

      case 'UNDO_LAST_ACTION':
        return this.handleUndoLastAction(now);

      case 'RESET_ROUND':
        return this.handleResetRound(now);

      default:
        throw new RoscoSecurityError('UNKNOWN_ACTION', 'Acción no reconocida por el servidor.', 400);
    }
  }

  // ==========================================================================
  // IMPLEMENTACIÓN DETALLADA DE CADA MECÁNICA DEL PRESENTADOR
  // ==========================================================================

  private handleUpdateConfig(partial: Partial<RoomConfig>, now: number): GameEventType {
    if (this.status === 'PLAYING') {
      // Durante la partida solo permitimos cambiar visibilidad de clasificación o nombre
      if (typeof partial.showLeaderboardDuringGame === 'boolean') {
        this.config.showLeaderboardDuringGame = partial.showLeaderboardDuringGame;
      }
      if (partial.roomName) {
        this.config.roomName = partial.roomName;
      }
    } else {
      if (partial.roomName !== undefined) this.config.roomName = partial.roomName;
      if (partial.isPublic !== undefined) this.config.isPublic = partial.isPublic;
      if (partial.timerSeconds !== undefined && partial.timerSeconds >= 15 && partial.timerSeconds <= 900) {
        this.config.timerSeconds = Math.round(partial.timerSeconds);
        const newInitialMs = this.config.timerSeconds * 1000;
        for (const c of this.contestants.values()) {
          c.timer.initialMs = newInitialMs;
          c.timer.remainingMs = newInitialMs;
          c.timer.consumedMs = 0;
          c.score.timeRemainingMs = newInitialMs;
          c.score.timeConsumedMs = 0;
        }
      }
      if (partial.pointsCorrect !== undefined) this.config.pointsCorrect = partial.pointsCorrect;
      if (partial.pointsIncorrect !== undefined) this.config.pointsIncorrect = partial.pointsIncorrect;
      if (partial.pointsPasapalabra !== undefined) this.config.pointsPasapalabra = partial.pointsPasapalabra;
      if (partial.showLeaderboardDuringGame !== undefined) {
        this.config.showLeaderboardDuringGame = partial.showLeaderboardDuringGame;
      }
      if (partial.selectedCategories !== undefined) {
        this.config.selectedCategories = partial.selectedCategories;
      }
      if (partial.selectedDifficulty !== undefined) {
        this.config.selectedDifficulty = partial.selectedDifficulty;
      }
      // Regenerar selección de 27 preguntas conforme a los nuevos filtros
      this.roundQuestions = selectRoundQuestions({
        bank: this.customQuestionBank,
        categories: this.config.selectedCategories,
        difficulty: this.config.selectedDifficulty,
        previouslyUsedIds: this.previouslyUsedQuestionIds,
      });
      for (const c of this.contestants.values()) {
        c.letters = this.createInitialLettersForPlayer();
      }
    }

    return this.recordEvent(
      'LEADERBOARD_UPDATED',
      'HOST',
      null,
      null,
      `Configuración actualizada (${this.config.timerSeconds}s por jugador, +${this.config.pointsCorrect} pts/acierto)`,
      false,
      now
    );
  }

  private handleReorderPlayers(orderedPlayerIds: string[], now: number): GameEventType {
    let order = 1;
    for (const id of orderedPlayerIds) {
      const c = this.contestants.get(id);
      if (c && c.status !== 'KICKED') {
        c.turnOrder = order++;
      }
    }
    for (const c of this.getActiveContestantList()) {
      if (!orderedPlayerIds.includes(c.id)) {
        c.turnOrder = order++;
      }
    }
    return this.recordEvent(
      'TURN_ORDER_UPDATED',
      'HOST',
      null,
      null,
      'El presentador ha actualizado el orden de participación de los concursantes',
      false,
      now
    );
  }

  private handleStartGame(now: number): GameEventType {
    const contestantsList = this.getActiveContestantList();
    if (contestantsList.length === 0) {
      throw new RoscoSecurityError(
        'NO_CONTESTANTS',
        'Debe haber al menos 1 concursante en la sala para iniciar la partida.',
        400
      );
    }

    this.status = 'PLAYING';
    this.roundStartedAt = now;
    this.awaitingPasapalabraDecision = false;

    // Registrar las 27 preguntas seleccionadas para no repetirlas en rondas consecutivas
    for (const letter of ROSCO_LETTERS) {
      this.previouslyUsedQuestionIds.add(this.roundQuestions[letter].id);
    }

    const firstContestant = contestantsList[0];
    this.activateContestantInternal(firstContestant.id, now);

    return this.recordEvent(
      'GAME_STARTED',
      'HOST',
      firstContestant.id,
      this.activeLetter,
      `¡Comienza PRL-ROSCO! Turno inicial para ${firstContestant.name}`,
      false,
      now
    );
  }

  private handleSelectContestant(targetPlayerId: string, now: number): GameEventType {
    const target = this.contestants.get(targetPlayerId);
    if (!target || target.status === 'KICKED') {
      throw new RoscoSecurityError('PLAYER_NOT_FOUND', 'El concursante seleccionado no existe en la sala.', 404);
    }
    if (target.status === 'FINISHED' || target.timer.remainingMs <= 0 || target.score.pendingCount === 0) {
      throw new RoscoSecurityError(
        'PLAYER_ALREADY_FINISHED',
        `${target.name} ya ha finalizado su rosco o agotado su tiempo.`,
        400
      );
    }

    this.saveUndoSnapshot(`Cambio de turno a ${target.name}`);

    if (this.status === 'WAITING') {
      this.status = 'PLAYING';
    }

    this.activateContestantInternal(targetPlayerId, now);

    return this.recordEvent(
      'CONTESTANT_ACTIVATED',
      'HOST',
      targetPlayerId,
      this.activeLetter,
      `Turno en plató para ${target.name} (Letra ${this.activeLetter}, ${Math.ceil(target.timer.remainingMs / 1000)}s restantes)`,
      true,
      now
    );
  }

  private activateContestantInternal(targetPlayerId: string, now: number): void {
    // 1. Congelar cronómetro y guardar estado del concursante anterior si había uno activo
    if (this.activePlayerId && this.activePlayerId !== targetPlayerId) {
      const prev = this.contestants.get(this.activePlayerId);
      if (prev) {
        prev.timer.isRunning = false;
        prev.timer.lastServerSyncAt = now;
        if (prev.status === 'ACTIVE') {
          prev.status = prev.score.pendingCount > 0 && prev.timer.remainingMs > 0 ? 'PAUSED' : 'FINISHED';
        }
        // Si tenía una letra ACTIVE no respondida aún, la dejamos lista en UNSEEN o PASSED para cuando regrese
        for (const l of ROSCO_LETTERS) {
          if (prev.letters[l].state === 'ACTIVE') {
            prev.letters[l].state = prev.letters[l].attempts > 0 ? 'PASSED' : 'UNSEEN';
          }
        }
      }
    }

    // 2. Activar al nuevo concursante en el centro del escenario 3D
    const next = this.contestants.get(targetPlayerId)!;
    this.activePlayerId = next.id;
    next.status = 'ACTIVE';
    this.awaitingPasapalabraDecision = false;
    this.revealedAnswerForQuestionId = null;
    this.revealedExplanationForQuestionId = null;

    // 3. Localizar su letra pendiente actual o siguiente sin resolver
    const targetLetter = this.findNextUnresolvedLetter(next, next.currentLetter, true);
    if (targetLetter) {
      next.currentLetter = targetLetter;
      this.activeLetter = targetLetter;
      next.letters[targetLetter].state = 'ACTIVE';
      next.letters[targetLetter].attempts += 1;
    } else {
      this.activeLetter = null;
    }

    // 4. Iniciar/reanudar su cronómetro individual desde el punto exacto donde quedó
    this.timerLastTickTimestamp = now;
    next.timer.isRunning = this.status === 'PLAYING' && targetLetter !== null;
    next.timer.lastServerSyncAt = now;

    this.characterAnimation = 'TURN_INTRO';
    this.cameraShot = 'CONTESTANT_ENTRY';
  }

  private handleSkipAbsentContestant(playerId: string, now: number): GameEventType {
    const player = this.contestants.get(playerId);
    if (!player || player.status === 'KICKED') {
      throw new RoscoSecurityError('PLAYER_NOT_FOUND', 'Concursante no encontrado.', 404);
    }

    this.saveUndoSnapshot(`Marcar ausente y saltar a ${player.name}`);
    player.timer.isRunning = false;
    player.status = 'ABSENT';

    // Si era el jugador activo, pasar al siguiente disponible si existe
    if (this.activePlayerId === playerId) {
      const nextCandidate = this.findNextAvailableContestant(playerId);
      if (nextCandidate) {
        this.activateContestantInternal(nextCandidate.id, now);
      } else {
        this.activePlayerId = null;
        this.activeLetter = null;
      }
    }

    return this.recordEvent(
      'TURN_TRANSFERRED',
      'HOST',
      playerId,
      this.activeLetter,
      `Se ha saltado el turno de ${player.name} por ausencia`,
      true,
      now
    );
  }

  private handleKickContestant(playerId: string, now: number): GameEventType {
    const player = this.contestants.get(playerId);
    if (!player) {
      throw new RoscoSecurityError('PLAYER_NOT_FOUND', 'Concursante no encontrado.', 404);
    }

    player.timer.isRunning = false;
    player.status = 'KICKED';
    player.isConnected = false;

    if (this.activePlayerId === playerId) {
      const nextCandidate = this.findNextAvailableContestant(playerId);
      if (nextCandidate && this.status === 'PLAYING') {
        this.activateContestantInternal(nextCandidate.id, now);
      } else {
        this.activePlayerId = null;
        this.activeLetter = null;
      }
    }

    this.recalculateLeaderboard();

    return this.recordEvent(
      'PLAYER_KICKED',
      'HOST',
      playerId,
      null,
      `${player.name} ha sido expulsado de la sala por el presentador`,
      false,
      now
    );
  }

  private validateActiveQuestionTarget(
    expectedPlayerId: string,
    expectedLetter: RoscoLetter,
    expectedQuestionId: string
  ): { player: ContestantState; letterProgress: PlayerLetterProgress; question: PRLQuestion } {
    if (this.status !== 'PLAYING') {
      throw new RoscoSecurityError(
        'GAME_NOT_PLAYING',
        'La partida debe estar en curso (no en espera ni pausada) para registrar respuestas.',
        400
      );
    }
    if (this.awaitingPasapalabraDecision) {
      throw new RoscoSecurityError(
        'AWAITING_PASAPALABRA_DECISION',
        'Debes elegir primero qué hacer tras el Pasapalabra (continuar o ceder turno).',
        400
      );
    }
    if (!this.activePlayerId || !this.activeLetter) {
      throw new RoscoSecurityError('NO_ACTIVE_QUESTION', 'No hay ningún concursante o letra activa en este momento.', 400);
    }
    if (this.activePlayerId !== expectedPlayerId || this.activeLetter !== expectedLetter) {
      throw new RoscoSecurityError(
        'STALE_QUESTION_STATE',
        `Desincronización evitada: la acción iba dirigida a ${expectedLetter}, pero la letra activa es ${this.activeLetter}.`,
        409
      );
    }

    const player = this.contestants.get(this.activePlayerId)!;
    if (player.timer.remainingMs <= 0 || player.status === 'FINISHED') {
      throw new RoscoSecurityError('PLAYER_TIME_EXPIRED', 'El tiempo de este concursante ya ha terminado.', 400);
    }

    const letterProgress = player.letters[this.activeLetter];
    const question = this.roundQuestions[this.activeLetter];

    if (question.id !== expectedQuestionId) {
      throw new RoscoSecurityError(
        'QUESTION_ID_MISMATCH',
        'El identificador de la pregunta no coincide con la pregunta activa.',
        409
      );
    }

    if (letterProgress.state === 'CORRECT' || letterProgress.state === 'INCORRECT') {
      throw new RoscoSecurityError(
        'LETTER_ALREADY_CLOSED',
        `La letra ${this.activeLetter} ya fue cerrada anteriormente.`,
        409
      );
    }

    return { player, letterProgress, question };
  }

  private handleMarkAnswer(
    result: 'CORRECT' | 'INCORRECT',
    expectedPlayerId: string,
    expectedLetter: RoscoLetter,
    expectedQuestionId: string,
    now: number
  ): GameEventType {
    const { player, letterProgress } = this.validateActiveQuestionTarget(
      expectedPlayerId,
      expectedLetter,
      expectedQuestionId
    );

    this.saveUndoSnapshot(
      `${result === 'CORRECT' ? 'Acierto' : 'Fallo'} de ${player.name} en la letra ${expectedLetter}`
    );

    letterProgress.state = result;
    letterProgress.result = result;
    letterProgress.answeredAt = now;
    letterProgress.pointsEarned =
      result === 'CORRECT' ? this.config.pointsCorrect : this.config.pointsIncorrect;

    this.revealedAnswerForQuestionId = null;
    this.revealedExplanationForQuestionId = null;

    this.recalculatePlayerScore(player);
    this.recalculateLeaderboard();

    this.characterAnimation = result === 'CORRECT' ? 'CELEBRATE_CORRECT' : 'REACT_INCORRECT';
    this.cameraShot = result === 'CORRECT' ? 'CELEBRATION' : 'ACTIVE_QUESTION';

    const eventType: GameEventType =
      result === 'CORRECT' ? 'ANSWER_MARKED_CORRECT' : 'ANSWER_MARKED_INCORRECT';

    // Comprobar si al jugador le quedan letras sin resolver
    const nextLetter = this.findNextUnresolvedLetter(player, expectedLetter, false);

    if (!nextLetter) {
      // ¡El jugador ha completado las 27 letras de su rosco!
      player.timer.isRunning = false;
      player.status = 'FINISHED';
      this.activeLetter = null;
      this.characterAnimation = 'ROSCO_COMPLETE';
      this.cameraShot = 'TURN_END';

      this.recordEvent(
        eventType,
        'HOST',
        player.id,
        expectedLetter,
        `${player.name}: ${result === 'CORRECT' ? '¡ACIERTO!' : 'FALLO'} en la letra ${expectedLetter} y completa su rosco (${player.score.correctCount}/27 aciertos)`,
        true,
        now
      );

      this.recordEvent(
        'PLAYER_FINISHED',
        'SYSTEM',
        player.id,
        null,
        `¡${player.name} ha completado las 27 letras del Rosco PRL!`,
        false,
        now
      );

      this.checkIfAllContestantsFinished(now);
      return eventType;
    }

    // Avanzar a la siguiente letra pendiente del concursante
    this.advancePlayerToLetter(player, nextLetter);

    return this.recordEvent(
      eventType,
      'HOST',
      player.id,
      expectedLetter,
      `${player.name}: ${result === 'CORRECT' ? `¡ACIERTO! (+${this.config.pointsCorrect} pts)` : 'FALLO'} en la letra ${expectedLetter}. Siguiente letra: ${nextLetter}`,
      true,
      now
    );
  }

  private handleRegisterPasapalabra(
    expectedPlayerId: string,
    expectedLetter: RoscoLetter,
    expectedQuestionId: string,
    now: number
  ): GameEventType {
    const { player, letterProgress } = this.validateActiveQuestionTarget(
      expectedPlayerId,
      expectedLetter,
      expectedQuestionId
    );

    this.saveUndoSnapshot(`Pasapalabra de ${player.name} en la letra ${expectedLetter}`);

    // 1. Marcar la letra como PASSED (amarillo/naranja, pendiente, 0 puntos, 0 errores)
    letterProgress.state = 'PASSED';
    letterProgress.result = 'PENDING';
    letterProgress.pointsEarned = this.config.pointsPasapalabra;
    player.score.pasapalabraCount += 1;

    // 2. Congelar momentáneamente el cronómetro mientras el presentador decide en el modal si continúa o cede turno
    player.timer.isRunning = false;
    player.timer.lastServerSyncAt = now;
    this.awaitingPasapalabraDecision = true;
    this.characterAnimation = 'REACT_PASAPALABRA';
    this.cameraShot = 'ACTIVE_QUESTION';

    this.recalculatePlayerScore(player);
    this.recalculateLeaderboard();

    return this.recordEvent(
      'PASAPALABRA_REGISTERED',
      'HOST',
      player.id,
      expectedLetter,
      `¡Pasapalabra de ${player.name} en la letra ${expectedLetter}! Esperando decisión del presentador...`,
      true,
      now
    );
  }

  /**
   * MECÁNICA ESPECIAL DE PASAPALABRA (Sección 6):
   * El presentador elige tras pulsar Pasapalabra:
   * - OPCIÓN 1 (CONTINUE_SAME): Continúa el mismo concursante, su cronómetro sigue descontando y avanza a su siguiente letra pendiente.
   * - OPCIÓN 2 (TRANSFER_TURN): Cede el turno a otro concursante, congela y guarda el tiempo y letras pendientes del jugador actual, y presenta al siguiente concursante con su rosco y tiempo individual.
   */
  private handlePasapalabraDecision(
    decision: 'CONTINUE_SAME' | 'TRANSFER_TURN',
    requestedNextPlayerId: string | undefined,
    now: number
  ): GameEventType {
    if (!this.activePlayerId) {
      throw new RoscoSecurityError('NO_ACTIVE_PLAYER', 'No hay concursante activo.', 400);
    }

    const currentPlayer = this.contestants.get(this.activePlayerId)!;
    const currentLetter = this.activeLetter || currentPlayer.currentLetter;

    // Calcular cuál será la siguiente letra sin resolver de este concursante (para ahora o para cuando vuelva a su turno)
    const nextLetterForCurrent =
      this.findNextUnresolvedLetter(currentPlayer, currentLetter, false) || currentLetter;

    if (decision === 'CONTINUE_SAME') {
      this.awaitingPasapalabraDecision = false;
      this.advancePlayerToLetter(currentPlayer, nextLetterForCurrent);
      this.timerLastTickTimestamp = now;
      currentPlayer.timer.isRunning = true;
      currentPlayer.timer.lastServerSyncAt = now;
      this.characterAnimation = 'CONCENTRATION';
      this.cameraShot = 'ACTIVE_QUESTION';

      return this.recordEvent(
        'PASAPALABRA_CONTINUE',
        'HOST',
        currentPlayer.id,
        this.activeLetter,
        `${currentPlayer.name} conserva el turno tras Pasapalabra. Avanza a la letra ${this.activeLetter}`,
        false,
        now
      );
    }

    // OPCIÓN 2: CEDER EL TURNO A OTRO CONCURSANTE
    // Dejar preparada la siguiente letra pendiente del jugador saliente para cuando regrese
    currentPlayer.currentLetter = nextLetterForCurrent;
    currentPlayer.timer.isRunning = false;
    currentPlayer.timer.lastServerSyncAt = now;
    currentPlayer.status = 'PAUSED';
    this.awaitingPasapalabraDecision = false;

    let targetNextPlayer: ContestantState | null = null;
    if (requestedNextPlayerId) {
      const candidate = this.contestants.get(requestedNextPlayerId);
      if (
        candidate &&
        candidate.status !== 'KICKED' &&
        candidate.status !== 'FINISHED' &&
        candidate.timer.remainingMs > 0 &&
        candidate.score.pendingCount > 0
      ) {
        targetNextPlayer = candidate;
      }
    }

    if (!targetNextPlayer) {
      targetNextPlayer = this.findNextAvailableContestant(currentPlayer.id);
    }

    // Si no hay otro concursante disponible (p.ej. partida de 1 solo jugador o todos los demás terminaron), continúa el mismo jugador
    if (!targetNextPlayer || targetNextPlayer.id === currentPlayer.id) {
      currentPlayer.status = 'ACTIVE';
      this.advancePlayerToLetter(currentPlayer, nextLetterForCurrent);
      this.timerLastTickTimestamp = now;
      currentPlayer.timer.isRunning = true;
      return this.recordEvent(
        'PASAPALABRA_CONTINUE',
        'HOST',
        currentPlayer.id,
        this.activeLetter,
        `No hay otros concursantes con rosco pendiente; continúa ${currentPlayer.name} en la letra ${this.activeLetter}`,
        false,
        now
      );
    }

    this.activateContestantInternal(targetNextPlayer.id, now);

    return this.recordEvent(
      'TURN_TRANSFERRED',
      'HOST',
      targetNextPlayer.id,
      this.activeLetter,
      `Turno cedido: se pausa el tiempo de ${currentPlayer.name} (${Math.ceil(currentPlayer.timer.remainingMs / 1000)}s) y entra ${targetNextPlayer.name} en la letra ${this.activeLetter}`,
      false,
      now
    );
  }

  private handleNextLetter(now: number): GameEventType {
    if (!this.activePlayerId || !this.activeLetter) {
      throw new RoscoSecurityError('NO_ACTIVE_PLAYER', 'No hay jugador o letra activa.', 400);
    }
    const player = this.contestants.get(this.activePlayerId)!;
    const cur = player.letters[this.activeLetter];
    if (cur && cur.state === 'ACTIVE') {
      cur.state = 'PASSED';
    }
    const nextLetter =
      this.findNextUnresolvedLetter(player, this.activeLetter, false) || this.activeLetter;
    this.awaitingPasapalabraDecision = false;
    this.advancePlayerToLetter(player, nextLetter);

    return this.recordEvent(
      'QUESTION_ACTIVATED',
      'HOST',
      player.id,
      this.activeLetter,
      `Avance manual a la letra ${this.activeLetter} para ${player.name}`,
      false,
      now
    );
  }

  private handleRepeatQuestion(now: number): GameEventType {
    if (!this.activePlayerId || !this.activeLetter) {
      throw new RoscoSecurityError('NO_ACTIVE_QUESTION', 'No hay pregunta activa para repetir.', 400);
    }
    this.characterAnimation = 'CONCENTRATION';
    this.cameraShot = 'ACTIVE_QUESTION';
    return this.recordEvent(
      'QUESTION_REPEATED',
      'HOST',
      this.activePlayerId,
      this.activeLetter,
      `El presentador repite la pregunta de la letra ${this.activeLetter}`,
      false,
      now
    );
  }

  private handleRevealAnswer(now: number): GameEventType {
    if (!this.activeLetter) {
      throw new RoscoSecurityError('NO_ACTIVE_QUESTION', 'No hay pregunta activa.', 400);
    }
    const q = this.roundQuestions[this.activeLetter];
    this.revealedAnswerForQuestionId = q.id;
    return this.recordEvent(
      'ANSWER_REVEALED',
      'HOST',
      this.activePlayerId,
      this.activeLetter,
      `Respuesta revelada por el presentador (${this.activeLetter}): ${q.mainAnswer}`,
      false,
      now
    );
  }

  private handleShowExplanation(now: number): GameEventType {
    if (!this.activeLetter) {
      throw new RoscoSecurityError('NO_ACTIVE_QUESTION', 'No hay pregunta activa.', 400);
    }
    const q = this.roundQuestions[this.activeLetter];
    this.revealedExplanationForQuestionId = q.id;
    return this.recordEvent(
      'EXPLANATION_SHOWN',
      'HOST',
      this.activePlayerId,
      this.activeLetter,
      `Explicación técnica de PRL mostrada para la letra ${this.activeLetter}`,
      false,
      now
    );
  }

  private handlePauseGame(now: number): GameEventType {
    if (this.status !== 'PLAYING') {
      throw new RoscoSecurityError('GAME_NOT_PLAYING', 'La partida no está en curso.', 400);
    }
    this.status = 'PAUSED';
    if (this.activePlayerId) {
      const player = this.contestants.get(this.activePlayerId);
      if (player) {
        player.timer.isRunning = false;
        player.timer.lastServerSyncAt = now;
      }
    }
    return this.recordEvent(
      'GAME_PAUSED',
      'HOST',
      this.activePlayerId,
      this.activeLetter,
      'Partida pausada por el presentador (todos los cronómetros congelados)',
      false,
      now
    );
  }

  private handleResumeGame(now: number): GameEventType {
    if (this.status !== 'PAUSED') {
      throw new RoscoSecurityError('GAME_NOT_PAUSED', 'La partida no está en pausa.', 400);
    }
    this.status = 'PLAYING';
    this.timerLastTickTimestamp = now;
    if (this.activePlayerId && !this.awaitingPasapalabraDecision) {
      const player = this.contestants.get(this.activePlayerId);
      if (player && player.status === 'ACTIVE' && player.timer.remainingMs > 0) {
        player.timer.isRunning = true;
        player.timer.lastServerSyncAt = now;
      }
    }
    return this.recordEvent(
      'GAME_RESUMED',
      'HOST',
      this.activePlayerId,
      this.activeLetter,
      'Partida reanudada por el presentador',
      false,
      now
    );
  }

  private handlePausePersonalTimer(now: number): GameEventType {
    if (!this.activePlayerId) {
      throw new RoscoSecurityError('NO_ACTIVE_PLAYER', 'No hay concursante activo.', 400);
    }
    const player = this.contestants.get(this.activePlayerId)!;
    player.timer.isRunning = false;
    player.timer.lastServerSyncAt = now;
    return this.recordEvent(
      'PERSONAL_TIMER_PAUSED',
      'HOST',
      player.id,
      this.activeLetter,
      `Cronómetro individual de ${player.name} pausado (${Math.ceil(player.timer.remainingMs / 1000)}s)`,
      false,
      now
    );
  }

  private handleResumePersonalTimer(now: number): GameEventType {
    if (!this.activePlayerId) {
      throw new RoscoSecurityError('NO_ACTIVE_PLAYER', 'No hay concursante activo.', 400);
    }
    const player = this.contestants.get(this.activePlayerId)!;
    if (player.timer.remainingMs <= 0 || player.status === 'FINISHED') {
      throw new RoscoSecurityError('TIMER_ZERO', 'El concursante no tiene tiempo restante.', 400);
    }
    if (this.status === 'PAUSED') {
      this.status = 'PLAYING';
    }
    this.timerLastTickTimestamp = now;
    player.timer.isRunning = true;
    player.timer.lastServerSyncAt = now;
    return this.recordEvent(
      'PERSONAL_TIMER_RESUMED',
      'HOST',
      player.id,
      this.activeLetter,
      `Cronómetro individual de ${player.name} reanudado`,
      false,
      now
    );
  }

  private handleAddTime(playerId: string, deltaSeconds: number, now: number): GameEventType {
    const player = this.contestants.get(playerId);
    if (!player || player.status === 'KICKED') {
      throw new RoscoSecurityError('PLAYER_NOT_FOUND', 'Concursante no encontrado.', 404);
    }
    const deltaMs = Math.round(deltaSeconds * 1000);
    this.saveUndoSnapshot(`Ajuste de tiempo (${deltaSeconds > 0 ? '+' : ''}${deltaSeconds}s) a ${player.name}`);

    player.timer.remainingMs = Math.max(0, player.timer.remainingMs + deltaMs);
    if (player.timer.remainingMs > player.timer.initialMs) {
      player.timer.initialMs = player.timer.remainingMs;
    }
    player.score.timeRemainingMs = player.timer.remainingMs;

    if (player.status === 'FINISHED' && player.timer.remainingMs > 0 && player.score.pendingCount > 0) {
      player.status = this.activePlayerId === player.id ? 'ACTIVE' : 'PAUSED';
    }

    return this.recordEvent(
      'PERSONAL_TIMER_UPDATED',
      'HOST',
      player.id,
      this.activeLetter,
      `El presentador ha añadido ${deltaSeconds > 0 ? `+${deltaSeconds}` : deltaSeconds} segundos al cronómetro de ${player.name}`,
      true,
      now
    );
  }

  private handleFinishPlayerTurn(playerId: string, now: number): GameEventType {
    const player = this.contestants.get(playerId);
    if (!player || player.status === 'KICKED') {
      throw new RoscoSecurityError('PLAYER_NOT_FOUND', 'Concursante no encontrado.', 404);
    }
    this.saveUndoSnapshot(`Finalizar turno de ${player.name}`);

    player.timer.isRunning = false;
    player.status = 'FINISHED';
    for (const l of ROSCO_LETTERS) {
      if (player.letters[l].state === 'ACTIVE') {
        player.letters[l].state = 'PASSED';
      }
    }
    this.awaitingPasapalabraDecision = false;
    this.characterAnimation = 'ROSCO_COMPLETE';
    this.cameraShot = 'TURN_END';
    this.recalculatePlayerScore(player);
    this.recalculateLeaderboard();

    const evt = this.recordEvent(
      'PLAYER_FINISHED',
      'HOST',
      player.id,
      null,
      `Turno de ${player.name} finalizado manualmente por el presentador`,
      true,
      now
    );

    this.checkIfAllContestantsFinished(now);
    return evt;
  }

  private handleFinishGame(now: number): GameEventType {
    this.saveUndoSnapshot('Finalizar partida');
    this.finalizeRoundAndArchiveResults(now);
    return this.recordEvent(
      'GAME_FINISHED',
      'HOST',
      null,
      null,
      '¡Partida finalizada! Podio y clasificación definitiva de PRL-ROSCO disponibles.',
      true,
      now
    );
  }

  private handleUndoLastAction(now: number): GameEventType {
    if (!this.lastUndoSnapshot) {
      throw new RoscoSecurityError(
        'NOTHING_TO_UNDO',
        'No hay ninguna acción reciente del presentador que se pueda deshacer.',
        400
      );
    }

    const snap = this.lastUndoSnapshot;
    this.lastUndoSnapshot = null;

    this.status = snap.status;
    this.activePlayerId = snap.activePlayerId;
    this.activeLetter = snap.activeLetter;
    this.awaitingPasapalabraDecision = snap.awaitingPasapalabraDecision;
    this.revealedAnswerForQuestionId = snap.revealedAnswerForQuestionId;
    this.revealedExplanationForQuestionId = snap.revealedExplanationForQuestionId;
    this.characterAnimation = snap.characterAnimation;
    this.cameraShot = snap.cameraShot;

    const restoredList: ContestantState[] = JSON.parse(snap.contestantsJson);
    this.contestants.clear();
    for (const c of restoredList) {
      // Al deshacer, dejamos el cronómetro pausado o sincronizado al instante actual para seguridad
      c.timer.lastServerSyncAt = now;
      this.contestants.set(c.id, c);
    }
    this.timerLastTickTimestamp = now;
    this.recalculateLeaderboard();

    // Marcar en el registro de auditoría qué evento fue revertido
    const originalAudit = this.auditLog.find((a) => a.id === snap.auditEventId);
    if (originalAudit) {
      originalAudit.undoneAt = now;
      originalAudit.undoable = false;
    }

    return this.recordEvent(
      'ACTION_UNDONE',
      'HOST',
      this.activePlayerId,
      this.activeLetter,
      `Acción revertida por el presentador: "${snap.actionDescription}"`,
      false,
      now
    );
  }

  private handleResetRound(now: number): GameEventType {
    this.roundNumber += 1;
    this.roundStartedAt = now;
    this.status = 'WAITING';
    this.activePlayerId = null;
    this.activeLetter = null;
    this.awaitingPasapalabraDecision = false;
    this.revealedAnswerForQuestionId = null;
    this.revealedExplanationForQuestionId = null;
    this.lastUndoSnapshot = null;
    this.characterAnimation = 'WAIT';
    this.cameraShot = 'CONTESTANT_ENTRY';

    // Seleccionar 27 nuevas preguntas evitando repetir las de la ronda anterior
    this.roundQuestions = selectRoundQuestions({
      bank: this.customQuestionBank,
      categories: this.config.selectedCategories,
      difficulty: this.config.selectedDifficulty,
      previouslyUsedIds: this.previouslyUsedQuestionIds,
    });

    const initialMs = this.config.timerSeconds * 1000;
    for (const c of this.getActiveContestantList()) {
      c.status = 'WAITING';
      c.currentLetter = 'A';
      c.lapCount = 1;
      c.letters = this.createInitialLettersForPlayer();
      c.timer = {
        playerId: c.id,
        initialMs,
        remainingMs: initialMs,
        consumedMs: 0,
        isRunning: false,
        lastServerSyncAt: now,
      };
      this.recalculatePlayerScore(c);
    }
    this.recalculateLeaderboard();

    return this.recordEvent(
      'ROUND_RESET',
      'HOST',
      null,
      null,
      `Nueva ronda #${this.roundNumber} preparada con 27 nuevas preguntas de PRL`,
      false,
      now
    );
  }

  // ==========================================================================
  // ADMINISTRACIÓN DEL BANCO DE PREGUNTAS (SECCIÓN 10)
  // ==========================================================================

  public getQuestionBank(): PRLQuestion[] {
    return [...this.customQuestionBank];
  }

  public upsertQuestionInBank(hostToken: string | null | undefined, question: PRLQuestion): PRLQuestion {
    this.verifyHostToken(hostToken);
    if (!ROSCO_LETTERS.includes(question.letter)) {
      throw new RoscoSecurityError('INVALID_LETTER', `Letra inválida: ${question.letter}`, 400);
    }
    if (!question.statement.trim() || !question.mainAnswer.trim()) {
      throw new RoscoSecurityError('INVALID_QUESTION', 'El enunciado y la respuesta principal son obligatorios.', 400);
    }
    const idx = this.customQuestionBank.findIndex((q) => q.id === question.id);
    const saved: PRLQuestion = {
      ...question,
      reviewedAt: question.reviewedAt || new Date().toISOString().slice(0, 10),
      isActive: question.isActive ?? true,
    };
    if (idx >= 0) {
      this.customQuestionBank[idx] = saved;
    } else {
      this.customQuestionBank.push(saved);
    }
    // Si la pregunta editada está activa en la ronda actual, actualizarla también
    if (this.roundQuestions[saved.letter]?.id === saved.id) {
      this.roundQuestions[saved.letter] = saved;
    }
    return saved;
  }

  // ==========================================================================
  // FUNCIONES AUXILIARES DE ROSCO, VUELTAS Y DESEMPATE DE CLASIFICACIÓN
  // ==========================================================================

  private createInitialLettersForPlayer(): Record<RoscoLetter, PlayerLetterProgress> {
    const map = {} as Record<RoscoLetter, PlayerLetterProgress>;
    ROSCO_LETTERS.forEach((letter, index) => {
      map[letter] = {
        letter,
        questionId: this.roundQuestions[letter].id,
        state: 'UNSEEN',
        presentationOrder: index + 1,
        attempts: 0,
        result: 'PENDING',
        pointsEarned: 0,
        answeredAt: null,
      };
    });
    return map;
  }

  /**
   * Busca la siguiente letra sin resolver (UNSEEN o PASSED).
   * En la primera vuelta prioriza las letras UNSEEN en orden alfabético;
   * al completar la primera vuelta, vuelve circularmente sobre las letras PASSED (Pasapalabra).
   */
  private findNextUnresolvedLetter(
    player: ContestantState,
    fromLetter: RoscoLetter,
    includeCurrent: boolean
  ): RoscoLetter | null {
    const startIdx = ROSCO_LETTERS.indexOf(fromLetter);
    const total = ROSCO_LETTERS.length;

    // Comprobar primero si queda alguna letra UNSEEN de ahí hacia delante en la primera vuelta
    for (let offset = includeCurrent ? 0 : 1; offset < total; offset++) {
      const idx = (startIdx + offset) % total;
      const letter = ROSCO_LETTERS[idx];
      const st = player.letters[letter].state;
      if (st === 'UNSEEN' || st === 'PASSED' || st === 'ACTIVE') {
        if (idx < startIdx && !includeCurrent) {
          player.lapCount += 1;
        }
        return letter;
      }
    }

    // Comprobar si la propia letra actual sigue en PASSED
    if (!includeCurrent) {
      const currentState = player.letters[fromLetter].state;
      if (currentState === 'UNSEEN' || currentState === 'PASSED') {
        player.lapCount += 1;
        return fromLetter;
      }
    }

    return null;
  }

  private advancePlayerToLetter(player: ContestantState, nextLetter: RoscoLetter): void {
    player.currentLetter = nextLetter;
    this.activeLetter = nextLetter;
    player.letters[nextLetter].state = 'ACTIVE';
    player.letters[nextLetter].attempts += 1;
    this.revealedAnswerForQuestionId = null;
    this.revealedExplanationForQuestionId = null;
  }

  private findNextAvailableContestant(excludePlayerId?: string): ContestantState | null {
    const ordered = this.getActiveContestantList();
    if (ordered.length === 0) return null;

    const currentIndex = excludePlayerId
      ? ordered.findIndex((c) => c.id === excludePlayerId)
      : -1;

    for (let i = 1; i <= ordered.length; i++) {
      const idx = (Math.max(0, currentIndex) + i) % ordered.length;
      const candidate = ordered[idx];
      if (
        candidate.id !== excludePlayerId &&
        candidate.status !== 'FINISHED' &&
        candidate.status !== 'ABSENT' &&
        candidate.status !== 'KICKED' &&
        candidate.timer.remainingMs > 0 &&
        candidate.score.pendingCount > 0
      ) {
        return candidate;
      }
    }
    return null;
  }

  private recalculatePlayerScore(player: ContestantState): void {
    let correct = 0;
    let incorrect = 0;
    let pending = 0;
    let points = 0;

    for (const letter of ROSCO_LETTERS) {
      const item = player.letters[letter];
      if (item.state === 'CORRECT') {
        correct++;
        points += item.pointsEarned;
      } else if (item.state === 'INCORRECT') {
        incorrect++;
        points += item.pointsEarned;
      } else {
        pending++;
      }
    }

    const answered = correct + incorrect;
    player.score.correctCount = correct;
    player.score.incorrectCount = incorrect;
    player.score.pendingCount = pending;
    player.score.totalPoints = points;
    player.score.timeRemainingMs = player.timer.remainingMs;
    player.score.timeConsumedMs = player.timer.consumedMs;
    player.score.accuracyPct = answered > 0 ? Math.round((correct / answered) * 1000) / 10 : 0;
  }

  /**
   * Calcula la clasificación aplicando exactamente los criterios de desempate de la Sección 12:
   * 0. Mayor puntuación total.
   * 1. Más aciertos.
   * 2. Menos errores.
   * 3. Menor tiempo utilizado.
   */
  private recalculateLeaderboard(): PlayerScoreState[] {
    const list = this.getActiveContestantList();
    for (const c of list) {
      this.recalculatePlayerScore(c);
    }

    const sorted = [...list].sort((a, b) => {
      if (b.score.totalPoints !== a.score.totalPoints) {
        return b.score.totalPoints - a.score.totalPoints;
      }
      // Desempate 1: Más aciertos
      if (b.score.correctCount !== a.score.correctCount) {
        return b.score.correctCount - a.score.correctCount;
      }
      // Desempate 2: Menos errores
      if (a.score.incorrectCount !== b.score.incorrectCount) {
        return a.score.incorrectCount - b.score.incorrectCount;
      }
      // Desempate 3: Menor tiempo utilizado
      if (a.score.timeConsumedMs !== b.score.timeConsumedMs) {
        return a.score.timeConsumedMs - b.score.timeConsumedMs;
      }
      return a.turnOrder - b.turnOrder;
    });

    sorted.forEach((contestant, index) => {
      contestant.score.rankPosition = index + 1;
    });

    return sorted.map((c) => ({ ...c.score }));
  }

  private checkIfAllContestantsFinished(now: number): void {
    const list = this.getActiveContestantList();
    if (list.length === 0) return;

    const allDone = list.every(
      (c) =>
        c.status === 'FINISHED' ||
        c.status === 'ABSENT' ||
        c.timer.remainingMs <= 0 ||
        c.score.pendingCount === 0
    );

    if (allDone) {
      this.finalizeRoundAndArchiveResults(now);
      this.recordEvent(
        'GAME_FINISHED',
        'SYSTEM',
        null,
        null,
        '¡Todos los concursantes han completado su participación! Clasificación y podio 3D listos.',
        false,
        now
      );
    }
  }

  private finalizeRoundAndArchiveResults(now: number): void {
    this.status = 'FINISHED';
    this.awaitingPasapalabraDecision = false;
    this.characterAnimation = 'FINAL_VICTORY';
    this.cameraShot = 'WINNER_PODIUM';

    for (const c of this.contestants.values()) {
      c.timer.isRunning = false;
    }

    const standingsScores = this.recalculateLeaderboard();
    const podium = standingsScores.slice(0, 3).map((score, i) => {
      const c = this.contestants.get(score.playerId)!;
      return {
        rank: i + 1,
        playerId: c.id,
        name: c.name,
        avatar: c.avatar,
        score: { ...score },
      };
    });

    const standings = standingsScores.map((score, i) => {
      const c = this.contestants.get(score.playerId)!;
      return {
        rank: i + 1,
        playerId: c.id,
        name: c.name,
        score: { ...score },
      };
    });

    this.pastResults.unshift({
      id: `res-${this.roomId}-r${this.roundNumber}-${now}`,
      roomId: this.roomId,
      roomCode: this.roomCode,
      roundNumber: this.roundNumber,
      winnerPlayerId: podium[0]?.playerId ?? null,
      winnerName: podium[0]?.name ?? null,
      podium,
      standings,
      finishedAt: now,
    });
  }

  private getActiveContestantList(): ContestantState[] {
    return Array.from(this.contestants.values())
      .filter((c) => c.status !== 'KICKED')
      .sort((a, b) => a.turnOrder - b.turnOrder);
  }

  private saveUndoSnapshot(actionDescription: string): void {
    const contestantsArray = Array.from(this.contestants.values());
    this.lastUndoSnapshot = {
      status: this.status,
      activePlayerId: this.activePlayerId,
      activeLetter: this.activeLetter,
      awaitingPasapalabraDecision: this.awaitingPasapalabraDecision,
      revealedAnswerForQuestionId: this.revealedAnswerForQuestionId,
      revealedExplanationForQuestionId: this.revealedExplanationForQuestionId,
      characterAnimation: this.characterAnimation,
      cameraShot: this.cameraShot,
      contestantsJson: JSON.stringify(contestantsArray),
      actionDescription,
      auditEventId: `evt-${this.eventSeq + 1}`,
    };
  }

  private recordEvent(
    eventType: GameEventType,
    actorRole: 'HOST' | 'SYSTEM' | 'CONTESTANT',
    targetPlayerId: string | null,
    letter: RoscoLetter | null,
    description: string,
    undoable: boolean,
    now = Date.now()
  ): GameEventType {
    this.eventSeq += 1;
    this.stateVersion += 1;

    const auditItem: AuditEvent = {
      id: `evt-${this.eventSeq}`,
      seq: this.eventSeq,
      eventType,
      actorRole,
      targetPlayerId,
      letter,
      description,
      timestamp: now,
      undoable,
      undoneAt: null,
    };

    this.auditLog.unshift(auditItem);
    if (this.auditLog.length > 150) {
      this.auditLog.length = 150;
    }

    this.lastEvent = {
      type: eventType,
      timestamp: now,
      description,
      targetPlayerId,
      letter,
    };

    return eventType;
  }

  // ==========================================================================
  // VISTAS PÚBLICA Y PRIVADA DEL PRESENTADOR (SEPARACIÓN ESTRICTA DE DATOS)
  // ==========================================================================

  /**
   * Genera el estado público sincronizado para TODOS los clientes.
   * Garantiza que NINGUNA respuesta correcta ni variante privada se filtre a los concursantes.
   */
  public getPublicState(now = Date.now()): RoomPublicState {
    const activeQ = this.activeLetter ? this.roundQuestions[this.activeLetter] : null;
    const publicQuestion = activeQ
      ? toPublicQuestionView(activeQ, {
          revealAnswer: this.revealedAnswerForQuestionId === activeQ.id,
          revealExplanation: this.revealedExplanationForQuestionId === activeQ.id,
        })
      : null;

    const leaderboard = this.recalculateLeaderboard();

    return {
      roomId: this.roomId,
      roomCode: this.roomCode,
      status: this.status,
      roundNumber: this.roundNumber,
      stateVersion: this.stateVersion,
      eventSeq: this.eventSeq,
      hostConnected: this.hostConnected,
      config: { ...this.config },
      activePlayerId: this.activePlayerId,
      activeLetter: this.activeLetter,
      activeQuestion: publicQuestion,
      awaitingPasapalabraDecision: this.awaitingPasapalabraDecision,
      characterAnimation: this.characterAnimation,
      cameraShot: this.cameraShot,
      contestants: this.getActiveContestantList().map((c) => ({
        ...c,
        letters: { ...c.letters },
        timer: { ...c.timer },
        score: { ...c.score },
      })),
      leaderboard:
        this.config.showLeaderboardDuringGame || this.status === 'FINISHED'
          ? leaderboard
          : [],
      lastEvent: this.lastEvent ? { ...this.lastEvent } : null,
      serverTimestamp: now,
    };
  }

  /**
   * Genera la vista privada exclusiva del Presentador (validada siempre mediante hostToken).
   */
  public getPresenterPrivateState(hostToken: string | null | undefined): PresenterPrivateState {
    this.verifyHostToken(hostToken);
    const activeQ = this.activeLetter ? this.roundQuestions[this.activeLetter] : null;

    return {
      activeQuestionPrivate: activeQ ? { ...activeQ } : null,
      roundQuestions: { ...this.roundQuestions },
      canUndo: this.lastUndoSnapshot !== null,
      lastUndoableDescription: this.lastUndoSnapshot?.actionDescription ?? null,
      auditLog: [...this.auditLog],
    };
  }
}
