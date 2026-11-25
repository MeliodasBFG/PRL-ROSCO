// ============================================================================
// PRL-ROSCO — CONTRATO COMPARTIDO DE TIPOS (FRONTEND + CLOUDFLARE WORKER/DO)
// ============================================================================

export const ROSCO_LETTERS = [
  'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I',
  'J', 'K', 'L', 'M', 'N', 'Ñ', 'O', 'P', 'Q',
  'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z',
] as const;

export type RoscoLetter = (typeof ROSCO_LETTERS)[number];

export const MAX_CONTESTANTS = 15;
export const DEFAULT_TIMER_SECONDS = 120;
export const TIMER_PRESETS = [60, 90, 120, 180, 240] as const;

export const PRL_CATEGORIES = [
  'Seguridad en el trabajo',
  'Higiene industrial',
  'Ergonomía',
  'Psicosociología aplicada',
  'Equipos de protección individual',
  'Señalización',
  'Incendios',
  'Evacuación',
  'Primeros auxilios',
  'Riesgo eléctrico',
  'Trabajos en altura',
  'Manipulación de cargas',
  'Productos químicos',
  'Máquinas y herramientas',
  'Pantallas de visualización',
  'Ruido y vibraciones',
  'Agentes biológicos',
  'Riesgos de oficinas',
  'Riesgos de almacenes',
  'Riesgos de construcción',
  'Evaluación de riesgos',
  'Planificación preventiva',
  'Derechos y obligaciones',
  'Investigación de accidentes',
] as const;

export type PRLCategory = (typeof PRL_CATEGORIES)[number];

export type QuestionMode = 'EMPIEZA_POR' | 'CONTIENE';
export type QuestionDifficulty = 'FACIL' | 'MEDIA' | 'DIFICIL';

export type LetterState =
  | 'UNSEEN'     // Gris: todavía no presentada
  | 'ACTIVE'     // Azul: pregunta actual activa
  | 'PASSED'     // Amarillo/Naranja: pasada con Pasapalabra y pendiente
  | 'CORRECT'    // Verde: contestada correctamente
  | 'INCORRECT'; // Rojo: contestada incorrectamente

export type RoomStatus = 'WAITING' | 'PLAYING' | 'PAUSED' | 'FINISHED';

export type PlayerStatus =
  | 'WAITING'      // Esperando su turno
  | 'ACTIVE'       // Jugando actualmente en el centro del plató
  | 'PAUSED'       // Con turno cedido y preguntas pendientes
  | 'FINISHED'     // Ha completado su rosco o agotado su tiempo
  | 'DISCONNECTED' // Desconectado temporalmente (conserva estado y tiempo)
  | 'ABSENT'       // Marcado como ausente por el presentador
  | 'KICKED';      // Expulsado de la sala

export type CharacterAnimationState =
  | 'WAIT'
  | 'CONCENTRATION'
  | 'CELEBRATE_CORRECT'
  | 'REACT_INCORRECT'
  | 'REACT_PASAPALABRA'
  | 'TURN_INTRO'
  | 'ROSCO_COMPLETE'
  | 'FINAL_VICTORY';

export type CameraShot =
  | 'CONTESTANT_ENTRY'
  | 'ACTIVE_QUESTION'
  | 'CELEBRATION'
  | 'TURN_END'
  | 'WINNER_PODIUM';

export type HairStyle = 'short' | 'parted' | 'curly' | 'bun' | 'bob' | 'spiky';
export type AvatarAccessory = 'none' | 'glasses' | 'headset' | 'helmet';

export interface AvatarConfig {
  id: string;
  skinColor: string;
  hairStyle: HairStyle;
  hairColor: string;
  outfitColor: string;
  collarColor: string;
  accessory: AvatarAccessory;
  badgeColor: string;
}

export const AVATAR_SKIN_TONES = [
  '#f6d1b8',
  '#ecc09e',
  '#dfa67b',
  '#c5885c',
  '#9c643f',
  '#6d4329',
] as const;

export const AVATAR_HAIR_COLORS = [
  '#1c1613',
  '#3b271a',
  '#6e4225',
  '#b87a3d',
  '#d8af62',
  '#8c2d19',
  '#475569',
] as const;

export const AVATAR_OUTFIT_COLORS = [
  { name: 'Turquesa Plató', primary: '#2ce5c4', collar: '#22c7a9' },
  { name: 'Azul Real', primary: '#2563eb', collar: '#1d4ed8' },
  { name: 'Coral TV', primary: '#f43f5e', collar: '#e11d48' },
  { name: 'Esmeralda PRL', primary: '#10b981', collar: '#059669' },
  { name: 'Ámbar Seguridad', primary: '#f59e0b', collar: '#d97706' },
  { name: 'Violeta Estudio', primary: '#8b5cf6', collar: '#7c3aed' },
  { name: 'Cian Eléctrico', primary: '#06b6d4', collar: '#0891b2' },
  { name: 'Blanco Técnico', primary: '#e2e8f0', collar: '#cbd5e1' },
] as const;

export const DEFAULT_AVATAR_CONFIGS: AvatarConfig[] = AVATAR_OUTFIT_COLORS.map((outfit, idx) => ({
  id: `preset-${idx + 1}`,
  skinColor: AVATAR_SKIN_TONES[idx % AVATAR_SKIN_TONES.length],
  hairStyle: (['parted', 'short', 'bob', 'curly', 'bun', 'spiky'] as HairStyle[])[idx % 6],
  hairColor: AVATAR_HAIR_COLORS[idx % AVATAR_HAIR_COLORS.length],
  outfitColor: outfit.primary,
  collarColor: outfit.collar,
  accessory: (['none', 'glasses', 'none', 'helmet', 'none', 'headset'] as AvatarAccessory[])[idx % 6],
  badgeColor: '#d97706',
}));

/**
 * Modelo completo de pregunta de PRL (SOLO SERVIDOR Y PRESENTADOR)
 */
export interface PRLQuestion {
  id: string;
  letter: RoscoLetter;
  mode: QuestionMode;
  statement: string;
  mainAnswer: string;
  acceptedVariants: string[];
  synonyms: string[];
  explanation: string;
  category: PRLCategory;
  difficulty: QuestionDifficulty;
  source: string;
  sourceUrl: string;
  reviewedAt: string;
  isActive?: boolean;
}

/**
 * Modelo público de pregunta enviado a los concursantes.
 * NUNCA contiene mainAnswer, acceptedVariants, synonyms ni explanation
 * salvo que el presentador haya pulsado deliberadamente "Revelar respuesta" o "Mostrar explicación".
 */
export interface PublicQuestionView {
  id: string;
  letter: RoscoLetter;
  mode: QuestionMode;
  statement: string;
  category: PRLCategory;
  difficulty: QuestionDifficulty;
  revealedAnswer?: string;
  revealedVariants?: string[];
  revealedExplanation?: string;
  revealedSource?: string;
  revealedSourceUrl?: string;
}

export interface PlayerLetterProgress {
  letter: RoscoLetter;
  questionId: string;
  state: LetterState;
  presentationOrder: number;
  attempts: number;
  result: 'PENDING' | 'CORRECT' | 'INCORRECT';
  pointsEarned: number;
  answeredAt: number | null;
}

export interface PlayerTimerState {
  playerId: string;
  initialMs: number;
  remainingMs: number;
  consumedMs: number;
  isRunning: boolean;
  lastServerSyncAt: number;
}

export interface PlayerScoreState {
  playerId: string;
  correctCount: number;
  incorrectCount: number;
  pasapalabraCount: number;
  pendingCount: number;
  totalPoints: number;
  timeConsumedMs: number;
  timeRemainingMs: number;
  accuracyPct: number;
  rankPosition: number;
}

export interface ContestantState {
  id: string;
  name: string;
  avatar: AvatarConfig;
  turnOrder: number;
  status: PlayerStatus;
  isConnected: boolean;
  currentLetter: RoscoLetter;
  lapCount: number;
  letters: Record<RoscoLetter, PlayerLetterProgress>;
  timer: PlayerTimerState;
  score: PlayerScoreState;
}

export interface RoomConfig {
  roomName: string;
  isPublic: boolean;
  timerSeconds: number;
  pointsCorrect: number;
  pointsIncorrect: number;
  pointsPasapalabra: number;
  showLeaderboardDuringGame: boolean;
  selectedCategories: PRLCategory[];
  selectedDifficulty: 'TODAS' | QuestionDifficulty;
}

export interface AuditEvent {
  id: string;
  seq: number;
  eventType: GameEventType;
  actorRole: 'HOST' | 'SYSTEM' | 'CONTESTANT';
  targetPlayerId: string | null;
  letter: RoscoLetter | null;
  description: string;
  timestamp: number;
  undoable: boolean;
  undoneAt: number | null;
}

export type GameEventType =
  | 'ROOM_CREATED'
  | 'PLAYER_JOINED'
  | 'PLAYER_LEFT'
  | 'PLAYER_RECONNECTED'
  | 'PLAYER_KICKED'
  | 'TURN_ORDER_UPDATED'
  | 'GAME_STARTED'
  | 'CONTESTANT_ACTIVATED'
  | 'QUESTION_ACTIVATED'
  | 'QUESTION_REPEATED'
  | 'ANSWER_MARKED_CORRECT'
  | 'ANSWER_MARKED_INCORRECT'
  | 'PASAPALABRA_REGISTERED'
  | 'PASAPALABRA_CONTINUE'
  | 'TURN_TRANSFERRED'
  | 'PERSONAL_TIMER_PAUSED'
  | 'PERSONAL_TIMER_RESUMED'
  | 'PERSONAL_TIMER_UPDATED'
  | 'TIMER_EXPIRED'
  | 'PLAYER_FINISHED'
  | 'GAME_PAUSED'
  | 'GAME_RESUMED'
  | 'ANSWER_REVEALED'
  | 'EXPLANATION_SHOWN'
  | 'ACTION_UNDONE'
  | 'LEADERBOARD_UPDATED'
  | 'GAME_FINISHED'
  | 'ROUND_RESET';

/**
 * Estado público sincronizado con todos los clientes (concursantes y presentador).
 * Garantiza que ninguna respuesta privada viaje a los concursantes.
 */
export interface RoomPublicState {
  roomId: string;
  roomCode: string;
  status: RoomStatus;
  roundNumber: number;
  stateVersion: number;
  eventSeq: number;
  hostConnected: boolean;
  config: RoomConfig;
  activePlayerId: string | null;
  activeLetter: RoscoLetter | null;
  activeQuestion: PublicQuestionView | null;
  awaitingPasapalabraDecision: boolean;
  characterAnimation: CharacterAnimationState;
  cameraShot: CameraShot;
  contestants: ContestantState[];
  leaderboard: PlayerScoreState[];
  lastEvent: {
    type: GameEventType;
    timestamp: number;
    description: string;
    targetPlayerId?: string | null;
    letter?: RoscoLetter | null;
  } | null;
  serverTimestamp: number;
}

/**
 * Información exclusiva y protegida enviada ÚNICAMENTE al socket autenticado del Presentador.
 */
export interface PresenterPrivateState {
  activeQuestionPrivate: PRLQuestion | null;
  roundQuestions: Record<RoscoLetter, PRLQuestion>;
  canUndo: boolean;
  lastUndoableDescription: string | null;
  auditLog: AuditEvent[];
}

export type PresenterActionPayload =
  | { type: 'UPDATE_CONFIG'; actionId: string; config: Partial<RoomConfig> }
  | { type: 'REORDER_PLAYERS'; actionId: string; orderedPlayerIds: string[] }
  | { type: 'START_GAME'; actionId: string }
  | { type: 'SELECT_CONTESTANT'; actionId: string; playerId: string }
  | { type: 'SKIP_ABSENT_CONTESTANT'; actionId: string; playerId: string }
  | { type: 'KICK_CONTESTANT'; actionId: string; playerId: string }
  | { type: 'MARK_CORRECT'; actionId: string; expectedPlayerId: string; expectedLetter: RoscoLetter; expectedQuestionId: string }
  | { type: 'MARK_INCORRECT'; actionId: string; expectedPlayerId: string; expectedLetter: RoscoLetter; expectedQuestionId: string }
  | { type: 'REGISTER_PASAPALABRA'; actionId: string; expectedPlayerId: string; expectedLetter: RoscoLetter; expectedQuestionId: string }
  | { type: 'PASAPALABRA_DECISION'; actionId: string; decision: 'CONTINUE_SAME' | 'TRANSFER_TURN'; nextPlayerId?: string }
  | { type: 'NEXT_LETTER'; actionId: string }
  | { type: 'REPEAT_QUESTION'; actionId: string }
  | { type: 'REVEAL_ANSWER'; actionId: string }
  | { type: 'SHOW_EXPLANATION'; actionId: string }
  | { type: 'PAUSE_GAME'; actionId: string }
  | { type: 'RESUME_GAME'; actionId: string }
  | { type: 'PAUSE_TIMER'; actionId: string }
  | { type: 'RESUME_TIMER'; actionId: string }
  | { type: 'ADD_TIME'; actionId: string; playerId: string; deltaSeconds: number }
  | { type: 'FINISH_PLAYER_TURN'; actionId: string; playerId: string }
  | { type: 'FINISH_GAME'; actionId: string }
  | { type: 'TOGGLE_LEADERBOARD'; actionId: string; visible: boolean }
  | { type: 'UNDO_LAST_ACTION'; actionId: string }
  | { type: 'RESET_ROUND'; actionId: string };

export type ServerToClientMessage =
  | {
      type: 'STATE_SYNC';
      event: GameEventType;
      publicState: RoomPublicState;
      presenterPrivate?: PresenterPrivateState;
    }
  | {
      type: 'TIMER_TICK';
      activePlayerId: string | null;
      remainingMs: number;
      consumedMs: number;
      isRunning: boolean;
      serverTimestamp: number;
    }
  | {
      type: 'ERROR';
      code: string;
      message: string;
    };
