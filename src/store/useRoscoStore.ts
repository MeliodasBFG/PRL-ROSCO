import { create } from 'zustand';
import {
  AvatarConfig,
  GameEventType,
  PresenterActionPayload,
  PresenterPrivateState,
  PRLQuestion,
  RoomConfig,
  RoomPublicState,
  ServerToClientMessage,
} from '../../shared/types';
import { PastRoundResult } from '../../shared/roscoGameEngine';
import { soundEngine } from '../audio/soundEngine';

export type ClientRole = 'NONE' | 'HOST' | 'CONTESTANT';
export type ConnectionStatus = 'DISCONNECTED' | 'CONNECTING' | 'CONNECTED' | 'RECONNECTING';
export type DistributiveOmit<T, K extends keyof any> = T extends any ? Omit<T, K> : never;
export type PresenterCommandInput = DistributiveOmit<PresenterActionPayload, 'actionId'>;

interface RoscoClientStore {
  role: ClientRole;
  roomCode: string | null;
  authToken: string | null;
  myPlayerId: string | null;
  connectionStatus: ConnectionStatus;
  errorMessage: string | null;

  publicState: RoomPublicState | null;
  presenterPrivate: PresenterPrivateState | null;
  questionBank: PRLQuestion[];
  pastResults: PastRoundResult[];

  // Cuenta atrás interpolada localmente pero gobernada de forma autoritativa por el servidor
  displayRemainingMs: number;
  force2DStage: boolean;

  // Acciones públicas
  clearError: () => void;
  setForce2DStage: (force: boolean) => void;
  createRoomAsPresenter: (config?: Partial<RoomConfig>, customCode?: string) => Promise<boolean>;
  joinRoomAsContestant: (
    roomCode: string,
    name: string,
    avatar: AvatarConfig
  ) => Promise<boolean>;
  sendPresenterAction: (
    payload: PresenterCommandInput
  ) => Promise<boolean>;
  fetchQuestionBank: () => Promise<void>;
  saveQuestionInBank: (question: PRLQuestion) => Promise<boolean>;
  fetchPastResults: () => Promise<void>;
  leaveRoom: () => void;
  tickLocalTimerDisplay: () => void;
}

const SESSION_STORAGE_KEY = 'prl_rosco_active_session_v1';

function getApiBaseUrl(): string {
  const envUrl = (import.meta as any).env?.VITE_API_URL;
  if (envUrl && typeof envUrl === 'string' && envUrl.trim() !== '') {
    // Si estamos en desarrollo con el middleware de Vite en el puerto 5173 y VITE_API_URL apunta a localhost:8787
    // usamos rutas relativas '/api' por defecto salvo que sea un dominio remoto de Cloudflare Workers
    if (
      typeof window !== 'undefined' &&
      envUrl.includes('localhost:8787') &&
      window.location.port !== '8787'
    ) {
      return '';
    }
    return envUrl.replace(/\/$/, '');
  }
  return '';
}

function getWsBaseUrl(): string {
  const envWs = (import.meta as any).env?.VITE_WS_URL;
  if (envWs && typeof envWs === 'string' && envWs.trim() !== '') {
    if (
      typeof window !== 'undefined' &&
      envWs.includes('localhost:8787') &&
      window.location.port !== '8787'
    ) {
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      return `${proto}//${window.location.host}`;
    }
    return envWs.replace(/\/$/, '');
  }
  if (typeof window !== 'undefined') {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${window.location.host}`;
  }
  return 'ws://localhost:8787';
}

let activeWebSocket: WebSocket | null = null;
let pollIntervalId: number | null = null;
let broadcastChannel: BroadcastChannel | null = null;
let lastServerSyncPerfNow = 0;
let baseServerRemainingMs = 0;
let lastWarningSecondBeeped = -1;

function triggerAudioForEvent(event: GameEventType, publicState: RoomPublicState) {
  switch (event) {
    case 'ROOM_CREATED':
    case 'GAME_STARTED':
      soundEngine.playSfx('ROOM_START');
      break;
    case 'CONTESTANT_ACTIVATED':
      soundEngine.playSfx('CONTESTANT_INTRO');
      break;
    case 'QUESTION_ACTIVATED':
    case 'QUESTION_REPEATED':
      soundEngine.playSfx('LETTER_ACTIVATE');
      break;
    case 'ANSWER_MARKED_CORRECT':
      soundEngine.playSfx('CORRECT');
      break;
    case 'ANSWER_MARKED_INCORRECT':
      soundEngine.playSfx('INCORRECT');
      break;
    case 'PASAPALABRA_REGISTERED':
      soundEngine.playSfx('PASAPALABRA');
      break;
    case 'PASAPALABRA_CONTINUE':
      soundEngine.playSfx('LETTER_ACTIVATE');
      break;
    case 'TURN_TRANSFERRED':
      soundEngine.playSfx('TURN_CHANGE');
      break;
    case 'PERSONAL_TIMER_RESUMED':
    case 'GAME_RESUMED':
      soundEngine.playSfx('TIMER_START');
      break;
    case 'TIMER_EXPIRED':
      soundEngine.playSfx('TIMER_EXPIRED');
      break;
    case 'PLAYER_FINISHED':
      soundEngine.playSfx('ROSCO_COMPLETE');
      break;
    case 'GAME_FINISHED':
      soundEngine.playSfx('VICTORY');
      break;
  }

  // Ajustar pista musical ambiental según el estado de la partida
  if (publicState.status === 'WAITING') {
    soundEngine.setMusicTrack('LOBBY');
  } else if (publicState.status === 'FINISHED') {
    soundEngine.setMusicTrack('FINALE');
  } else if (publicState.status === 'PLAYING') {
    const activeContestant = publicState.contestants.find(
      (c) => c.id === publicState.activePlayerId
    );
    if (activeContestant && activeContestant.timer.remainingMs <= 20000) {
      soundEngine.setMusicTrack('TENSION');
    } else {
      soundEngine.setMusicTrack('QUIZ');
    }
  } else {
    soundEngine.setMusicTrack('NONE');
  }
}

export const useRoscoStore = create<RoscoClientStore>((set, get) => {
  const applyIncomingState = (
    publicState: RoomPublicState,
    presenterPrivate?: PresenterPrivateState,
    event?: GameEventType
  ) => {
    const current = get().publicState;
    // Ignorar versiones de estado más antiguas para evitar regresiones
    if (
      current &&
      current.roomId === publicState.roomId &&
      publicState.stateVersion < current.stateVersion
    ) {
      return;
    }

    const isNewEvent = !current || publicState.eventSeq > current.eventSeq;
    const activePlayer = publicState.contestants.find(
      (c) => c.id === publicState.activePlayerId
    );
    const remainingMs = activePlayer ? activePlayer.timer.remainingMs : 0;

    baseServerRemainingMs = remainingMs;
    lastServerSyncPerfNow = typeof performance !== 'undefined' ? performance.now() : Date.now();

    set((state) => ({
      publicState,
      // Un concursante NUNCA almacena presenterPrivate
      presenterPrivate:
        state.role === 'HOST' ? (presenterPrivate ?? state.presenterPrivate) : null,
      displayRemainingMs: remainingMs,
      connectionStatus: 'CONNECTED',
    }));

    if (isNewEvent && (event || publicState.lastEvent?.type)) {
      triggerAudioForEvent(event || publicState.lastEvent!.type, publicState);
    }
  };

  const setupRealtimeSync = (roomCode: string, token: string) => {
    // 1. Canal de sincronización instantánea entre pestañas locales
    if (typeof BroadcastChannel !== 'undefined') {
      if (broadcastChannel) broadcastChannel.close();
      broadcastChannel = new BroadcastChannel(`prl_rosco_room_${roomCode}`);
      broadcastChannel.onmessage = (ev) => {
        if (ev.data?.type === 'REFRESH_TRIGGER') {
          fetchLatestStateFromServer(roomCode, token);
        }
      };
    }

    // 2. Intentar conexión WebSocket con Cloudflare Durable Object (RoscoRoomDO)
    try {
      if (activeWebSocket) {
        activeWebSocket.close();
        activeWebSocket = null;
      }
      const wsUrl = `${getWsBaseUrl()}/api/rooms/${encodeURIComponent(
        roomCode
      )}/ws?token=${encodeURIComponent(token)}`;
      const ws = new WebSocket(wsUrl);
      activeWebSocket = ws;

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data) as ServerToClientMessage;
          if (msg.type === 'STATE_SYNC') {
            applyIncomingState(msg.publicState, msg.presenterPrivate, msg.event);
          } else if (msg.type === 'TIMER_TICK') {
            baseServerRemainingMs = msg.remainingMs;
            lastServerSyncPerfNow =
              typeof performance !== 'undefined' ? performance.now() : Date.now();
            set({ displayRemainingMs: msg.remainingMs });
          } else if (msg.type === 'ERROR') {
            set({ errorMessage: msg.message });
          }
        } catch {
          // Ignorar paquetes malformados
        }
      };
    } catch {
      // El sincronizador HTTP autoritativo mantiene la conexión viva
    }

    // 3. Sincronización continua autoritativa con el servidor (reconexión automática garantizada)
    if (pollIntervalId !== null && typeof window !== 'undefined') {
      window.clearInterval(pollIntervalId);
    }
    if (typeof window !== 'undefined') {
      pollIntervalId = window.setInterval(() => {
        const st = get();
        if (st.roomCode && st.authToken) {
          fetchLatestStateFromServer(st.roomCode, st.authToken);
        }
      }, 900);
    }
  };

  const fetchLatestStateFromServer = async (roomCode: string, token: string) => {
    try {
      const resp = await fetch(
        `${getApiBaseUrl()}/api/rooms/${encodeURIComponent(roomCode)}/state`,
        {
          headers: { 'X-Auth-Token': token },
        }
      );
      if (!resp.ok) return;
      const data = (await resp.json()) as any;
      if (data.ok && data.publicState) {
        applyIncomingState(data.publicState, data.presenterPrivate);
      }
    } catch {
      set((s) => ({
        connectionStatus: s.publicState ? 'RECONNECTING' : 'DISCONNECTED',
      }));
    }
  };

  return {
    role: 'NONE',
    roomCode: null,
    authToken: null,
    myPlayerId: null,
    connectionStatus: 'DISCONNECTED',
    errorMessage: null,
    publicState: null,
    presenterPrivate: null,
    questionBank: [],
    pastResults: [],
    displayRemainingMs: 120000,
    force2DStage: false,

    clearError: () => set({ errorMessage: null }),
    setForce2DStage: (force) => set({ force2DStage: force }),

    createRoomAsPresenter: async (config, customCode) => {
      soundEngine.unlock();
      set({ connectionStatus: 'CONNECTING', errorMessage: null });
      try {
        const resp = await fetch(`${getApiBaseUrl()}/api/rooms`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ config, customCode }),
        });
        const data = (await resp.json()) as any;
        if (!resp.ok || !data.ok) {
          set({
            connectionStatus: 'DISCONNECTED',
            errorMessage: data.message || 'No se pudo crear la sala.',
          });
          return false;
        }

        set({
          role: 'HOST',
          roomCode: data.roomCode,
          authToken: data.hostToken,
          myPlayerId: null,
          connectionStatus: 'CONNECTED',
        });

        applyIncomingState(data.publicState, data.presenterPrivate, 'ROOM_CREATED');
        setupRealtimeSync(data.roomCode, data.hostToken);

        if (typeof window !== 'undefined') {
          window.sessionStorage.setItem(
            SESSION_STORAGE_KEY,
            JSON.stringify({
              role: 'HOST',
              roomCode: data.roomCode,
              authToken: data.hostToken,
              myPlayerId: null,
            })
          );
        }
        return true;
      } catch (err) {
        set({
          connectionStatus: 'DISCONNECTED',
          errorMessage: err instanceof Error ? err.message : 'Error de red al crear la sala',
        });
        return false;
      }
    },

    joinRoomAsContestant: async (roomCodeInput, name, avatar) => {
      soundEngine.unlock();
      const cleanCode = roomCodeInput.trim().toUpperCase();
      set({ connectionStatus: 'CONNECTING', errorMessage: null });

      try {
        // Comprobar si tenemos un token previo de esta misma sala para reconexión
        let savedToken: string | undefined;
        if (typeof window !== 'undefined') {
          const raw = window.sessionStorage.getItem(SESSION_STORAGE_KEY);
          if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed.roomCode === cleanCode && parsed.role === 'CONTESTANT') {
              savedToken = parsed.authToken;
            }
          }
        }

        const resp = await fetch(
          `${getApiBaseUrl()}/api/rooms/${encodeURIComponent(cleanCode)}/join`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name,
              avatar,
              playerToken: savedToken,
            }),
          }
        );
        const data = (await resp.json()) as any;
        if (!resp.ok || !data.ok) {
          set({
            connectionStatus: 'DISCONNECTED',
            errorMessage: data.message || 'No se pudo entrar en la sala.',
          });
          return false;
        }

        set({
          role: 'CONTESTANT',
          roomCode: cleanCode,
          authToken: data.playerToken,
          myPlayerId: data.playerId,
          presenterPrivate: null, // Seguridad: ningún dato privado para concursantes
          connectionStatus: 'CONNECTED',
        });

        applyIncomingState(data.publicState, undefined, 'PLAYER_JOINED');
        setupRealtimeSync(cleanCode, data.playerToken);
        broadcastChannel?.postMessage({ type: 'REFRESH_TRIGGER' });

        if (typeof window !== 'undefined') {
          window.sessionStorage.setItem(
            SESSION_STORAGE_KEY,
            JSON.stringify({
              role: 'CONTESTANT',
              roomCode: cleanCode,
              authToken: data.playerToken,
              myPlayerId: data.playerId,
            })
          );
        }
        return true;
      } catch (err) {
        set({
          connectionStatus: 'DISCONNECTED',
          errorMessage: err instanceof Error ? err.message : 'Error de red al unirse a la sala',
        });
        return false;
      }
    },

    sendPresenterAction: async (actionWithoutId) => {
      soundEngine.unlock();
      const { role, roomCode, authToken } = get();
      if (role !== 'HOST' || !roomCode || !authToken) {
        set({ errorMessage: 'No tienes permisos de presentador para ejecutar esta acción.' });
        return false;
      }

      const payload: PresenterActionPayload = {
        ...actionWithoutId,
        actionId: `act_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      } as PresenterActionPayload;

      try {
        const resp = await fetch(
          `${getApiBaseUrl()}/api/rooms/${encodeURIComponent(roomCode)}/action`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Auth-Token': authToken,
            },
            body: JSON.stringify(payload),
          }
        );
        const data = (await resp.json()) as any;
        if (!resp.ok || !data.ok) {
          set({ errorMessage: data.message || 'Acción rechazada por el servidor.' });
          return false;
        }

        applyIncomingState(data.publicState, data.presenterPrivate, data.event);
        broadcastChannel?.postMessage({ type: 'REFRESH_TRIGGER' });
        return true;
      } catch (err) {
        set({
          errorMessage: err instanceof Error ? err.message : 'Error de comunicación con el servidor',
        });
        return false;
      }
    },

    fetchQuestionBank: async () => {
      const { roomCode, authToken, role } = get();
      if (role !== 'HOST' || !roomCode || !authToken) return;
      try {
        const resp = await fetch(
          `${getApiBaseUrl()}/api/rooms/${encodeURIComponent(roomCode)}/questions`,
          {
            headers: { 'X-Auth-Token': authToken },
          }
        );
        const data = (await resp.json()) as any;
        if (resp.ok && data.ok) {
          set({ questionBank: data.questions });
        }
      } catch {
        // Ignorar
      }
    },

    saveQuestionInBank: async (question) => {
      const { roomCode, authToken, role } = get();
      if (role !== 'HOST' || !roomCode || !authToken) return false;
      try {
        const resp = await fetch(
          `${getApiBaseUrl()}/api/rooms/${encodeURIComponent(roomCode)}/questions`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Auth-Token': authToken,
            },
            body: JSON.stringify(question),
          }
        );
        const data = (await resp.json()) as any;
        if (resp.ok && data.ok) {
          await get().fetchQuestionBank();
          return true;
        }
        set({ errorMessage: data.message || 'No se pudo guardar la pregunta.' });
        return false;
      } catch {
        return false;
      }
    },

    fetchPastResults: async () => {
      const { roomCode } = get();
      if (!roomCode) return;
      try {
        const resp = await fetch(
          `${getApiBaseUrl()}/api/rooms/${encodeURIComponent(roomCode)}/results`
        );
        const data = (await resp.json()) as any;
        if (resp.ok && data.ok) {
          set({ pastResults: data.results || [] });
        }
      } catch {
        // Ignorar
      }
    },

    leaveRoom: () => {
      if (activeWebSocket) {
        activeWebSocket.close();
        activeWebSocket = null;
      }
      if (pollIntervalId !== null && typeof window !== 'undefined') {
        window.clearInterval(pollIntervalId);
        pollIntervalId = null;
      }
      if (broadcastChannel) {
        broadcastChannel.close();
        broadcastChannel = null;
      }
      soundEngine.setMusicTrack('NONE');
      if (typeof window !== 'undefined') {
        window.sessionStorage.removeItem(SESSION_STORAGE_KEY);
      }
      set({
        role: 'NONE',
        roomCode: null,
        authToken: null,
        myPlayerId: null,
        publicState: null,
        presenterPrivate: null,
        connectionStatus: 'DISCONNECTED',
        errorMessage: null,
      });
    },

    tickLocalTimerDisplay: () => {
      const { publicState } = get();
      if (!publicState || publicState.status !== 'PLAYING' || !publicState.activePlayerId) {
        return;
      }
      const activePlayer = publicState.contestants.find(
        (c) => c.id === publicState.activePlayerId
      );
      if (!activePlayer || !activePlayer.timer.isRunning) {
        return;
      }

      const nowPerf = typeof performance !== 'undefined' ? performance.now() : Date.now();
      const elapsedSinceSync = Math.max(0, nowPerf - lastServerSyncPerfNow);
      const interpolated = Math.max(0, baseServerRemainingMs - elapsedSinceSync);

      const currentSec = Math.ceil(interpolated / 1000);
      if (currentSec <= 10 && currentSec > 0 && currentSec !== lastWarningSecondBeeped) {
        lastWarningSecondBeeped = currentSec;
        soundEngine.playSfx('TIMER_WARNING');
      }

      set({ displayRemainingMs: interpolated });
    },
  };
});
