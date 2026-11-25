import React, { useEffect, useState } from 'react';
import {
  ShieldCheck,
  Users,
  Play,
  Tv,
  Sparkles,
  Clock,
  Award,
  ArrowUp,
  ArrowDown,
  UserX,
  AlertCircle,
  CheckCircle2,
} from 'lucide-react';
import {
  AVATAR_HAIR_COLORS,
  AVATAR_OUTFIT_COLORS,
  AVATAR_SKIN_TONES,
  AvatarAccessory,
  AvatarConfig,
  DEFAULT_AVATAR_CONFIGS,
  DEFAULT_TIMER_SECONDS,
  HairStyle,
  MAX_CONTESTANTS,
  PRL_CATEGORIES,
  PRLCategory,
  QuestionDifficulty,
  TIMER_PRESETS,
} from '../../../shared/types';
import { useRoscoStore } from '../../store/useRoscoStore';
import { TVStudioStage3D } from '../studio3d/TVStudioStage3D';
import { QrCodeInviteCard } from '../ui/QrCodeInviteCard';
import { AudioControlsBar } from '../ui/AudioControlsBar';

export const WelcomeAndLobbyScreen: React.FC = () => {
  const {
    role,
    roomCode,
    publicState,
    errorMessage,
    clearError,
    createRoomAsPresenter,
    joinRoomAsContestant,
    sendPresenterAction,
    leaveRoom,
    force2DStage,
  } = useRoscoStore();

  // Detectar si viene código por URL (?room=XXXXXX)
  const [activeTab, setActiveTab] = useState<'CONTESTANT' | 'PRESENTER'>('CONTESTANT');
  const [joinCodeInput, setJoinCodeInput] = useState('');
  const [playerNameInput, setPlayerNameInput] = useState('');
  const [selectedAvatar, setSelectedAvatar] = useState<AvatarConfig>(DEFAULT_AVATAR_CONFIGS[0]);

  // Configuración inicial para el Profesor / Presentador
  const [roomNameInput, setRoomNameInput] = useState('Concurso Televisivo PRL-ROSCO');
  const [isPublicRoom, setIsPublicRoom] = useState(false);
  const [timerSeconds, setTimerSeconds] = useState<number>(DEFAULT_TIMER_SECONDS);
  const [customTimerInput, setCustomTimerInput] = useState<string>('120');
  const [useCustomTimer, setUseCustomTimer] = useState(false);
  const [pointsCorrect, setPointsCorrect] = useState(10);
  const [selectedDifficulty, setSelectedDifficulty] = useState<'TODAS' | QuestionDifficulty>(
    'TODAS'
  );
  const [selectedCategories, setSelectedCategories] = useState<PRLCategory[]>([]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const urlRoom = params.get('room');
      if (urlRoom) {
        setJoinCodeInput(urlRoom.toUpperCase());
        setActiveTab('CONTESTANT');
      }
    }
  }, []);

  const handleCreateRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    const finalSeconds = useCustomTimer
      ? Math.max(15, Math.min(900, parseInt(customTimerInput, 10) || 120))
      : timerSeconds;

    await createRoomAsPresenter({
      roomName: roomNameInput.trim() || 'Concurso PRL-ROSCO',
      isPublic: isPublicRoom,
      timerSeconds: finalSeconds,
      pointsCorrect,
      pointsIncorrect: 0,
      pointsPasapalabra: 0,
      showLeaderboardDuringGame: true,
      selectedCategories,
      selectedDifficulty,
    });
  };

  const handleJoinRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!joinCodeInput.trim() || !playerNameInput.trim()) return;
    await joinRoomAsContestant(joinCodeInput, playerNameInput, selectedAvatar);
  };

  const toggleCategory = (cat: PRLCategory) => {
    setSelectedCategories((prev) =>
      prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat]
    );
  };

  const handleMoveTurnOrder = (index: number, direction: -1 | 1) => {
    if (!publicState) return;
    const ids = publicState.contestants.map((c) => c.id);
    const targetIdx = index + direction;
    if (targetIdx < 0 || targetIdx >= ids.length) return;
    const temp = ids[index];
    ids[index] = ids[targetIdx];
    ids[targetIdx] = temp;
    sendPresenterAction({ type: 'REORDER_PLAYERS', orderedPlayerIds: ids });
  };

  // ==========================================================================
  // VISTA 2: SALA DE ESPERA (LOBBY) CUANDO YA SE HA CREADO O ENTRADO A LA SALA
  // ==========================================================================
  if (role !== 'NONE' && publicState && roomCode) {
    const contestants = publicState.contestants;
    const isHost = role === 'HOST';

    return (
      <div className="min-h-screen bg-gradient-to-b from-studio-900 via-studio-950 to-black text-white flex flex-col">
        {/* Barra superior de Sala de Espera */}
        <header className="px-4 sm:px-6 py-3 bg-studio-950/90 border-b border-blue-400/30 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-700 border border-white/40 flex items-center justify-center shadow-rosco-blue">
              <Tv className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="font-display font-black text-lg sm:text-xl tracking-wide text-white">
                  PRL-ROSCO
                </h1>
                <span className="px-2 py-0.5 rounded-full bg-blue-500/20 border border-blue-400/40 text-[10px] font-bold uppercase text-blue-200">
                  {isHost ? 'PANEL DE PRESENTADOR' : 'SALA DE ESPERA'}
                </span>
              </div>
              <p className="text-xs text-blue-300">{publicState.config.roomName}</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <AudioControlsBar />
            <button
              type="button"
              onClick={leaveRoom}
              className="px-3 py-2 rounded-lg bg-red-600/25 hover:bg-red-600/40 border border-red-400/40 text-xs font-bold text-red-200 transition"
            >
              Salir de la sala
            </button>
          </div>
        </header>

        {errorMessage && (
          <div className="mx-4 sm:mx-6 mt-3 p-3 rounded-xl bg-red-600/30 border border-red-400 flex items-center justify-between text-xs sm:text-sm text-red-100">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorMessage}</span>
            </div>
            <button onClick={clearError} className="underline font-bold ml-4">
              Cerrar
            </button>
          </div>
        )}

        <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Columna izquierda: Escenario 3D en vivo + Código QR */}
          <div className="lg:col-span-5 space-y-4">
            <QrCodeInviteCard roomCode={roomCode} />

            <div className="rounded-2xl overflow-hidden border-2 border-blue-400/40 shadow-studio-glow h-[340px] sm:h-[380px] relative">
              <TVStudioStage3D
                activeContestant={contestants[0] ?? null}
                activeLetter="A"
                characterAnimation="WAIT"
                cameraShot="CONTESTANT_ENTRY"
                force2DFallback={force2DStage}
              />
              <div className="absolute bottom-3 inset-x-3 px-3.5 py-2 rounded-xl bg-studio-950/85 border border-blue-400/30 backdrop-blur-md flex items-center justify-between text-xs">
                <span className="text-blue-200 font-semibold flex items-center gap-1.5">
                  <Sparkles className="w-4 h-4 text-amber-400" />
                  Plató 3D preparado · 27 Letras (A-Z, Ñ)
                </span>
                <span className="font-mono font-bold text-emerald-300">
                  {publicState.config.timerSeconds}s / jugador
                </span>
              </div>
            </div>
          </div>

          {/* Columna derecha: Lista de los 15 concursantes y controles de inicio */}
          <div className="lg:col-span-7 p-5 rounded-2xl bg-studio-900/85 border border-blue-400/35 shadow-2xl space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-blue-400/20 pb-3">
              <div>
                <h2 className="font-display font-black text-lg sm:text-xl text-white flex items-center gap-2">
                  <Users className="w-5 h-5 text-blue-400" />
                  CONCURSANTES EN SALA ({contestants.length} / {MAX_CONTESTANTS})
                </h2>
                <p className="text-xs text-blue-200">
                  {publicState.hostConnected
                    ? 'Presentador conectado en cabina de control'
                    : 'Esperando reconexión del presentador...'}
                </p>
              </div>

              {isHost && (
                <button
                  type="button"
                  data-testid="start-game-btn"
                  disabled={contestants.length === 0}
                  onClick={() => sendPresenterAction({ type: 'START_GAME' })}
                  className={`px-6 py-3 rounded-xl font-display font-black text-sm sm:text-base flex items-center gap-2 shadow-lg transition ${
                    contestants.length > 0
                      ? 'bg-gradient-to-r from-emerald-500 to-green-600 hover:from-emerald-400 hover:to-green-500 text-white shadow-rosco-green cursor-pointer'
                      : 'bg-slate-800 text-slate-500 cursor-not-allowed'
                  }`}
                >
                  <Play className="w-5 h-5 fill-current" />
                  ¡COMENZAR CONCURSO 3D!
                </button>
              )}
            </div>

            {contestants.length === 0 ? (
              <div className="p-8 rounded-xl bg-studio-950/60 border border-dashed border-blue-400/30 text-center space-y-2">
                <p className="text-sm font-bold text-blue-200">
                  Todavía no ha entrado ningún concursante en la sala.
                </p>
                <p className="text-xs text-slate-400">
                  Comparte el código <strong className="text-white font-mono">{roomCode}</strong> o
                  el código QR para que entren hasta 15 participantes simultáneos.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-[420px] overflow-y-auto pr-1">
                {contestants.map((c, index) => (
                  <div
                    key={c.id}
                    data-testid={`lobby-player-${c.name}`}
                    className="p-3 rounded-xl bg-studio-950/85 border border-blue-400/30 flex items-center justify-between gap-2"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="w-7 h-7 rounded-lg bg-blue-600/30 border border-blue-400/50 font-mono font-bold text-xs flex items-center justify-center text-blue-200 shrink-0">
                        #{index + 1}
                      </span>
                      <div
                        className="w-9 h-9 rounded-full border-2 border-white/50 flex items-center justify-center shrink-0 shadow"
                        style={{ backgroundColor: c.avatar.outfitColor }}
                      >
                        <div
                          className="w-4 h-4 rounded-full"
                          style={{ backgroundColor: c.avatar.skinColor }}
                        />
                      </div>
                      <div className="min-w-0">
                        <div className="font-bold text-sm text-white truncate">{c.name}</div>
                        <div className="flex items-center gap-1.5 text-[11px]">
                          <span
                            className={`w-2 h-2 rounded-full ${
                              c.isConnected ? 'bg-emerald-400' : 'bg-amber-400'
                            }`}
                          />
                          <span className="text-blue-300">
                            {c.isConnected ? 'Conectado' : 'Desconectado'} ·{' '}
                            {Math.round(c.timer.remainingMs / 1000)}s
                          </span>
                        </div>
                      </div>
                    </div>

                    {isHost && (
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => handleMoveTurnOrder(index, -1)}
                          disabled={index === 0}
                          title="Subir en el orden de turno"
                          className="p-1.5 rounded bg-studio-800 hover:bg-studio-700 disabled:opacity-30 text-blue-200"
                        >
                          <ArrowUp className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleMoveTurnOrder(index, 1)}
                          disabled={index === contestants.length - 1}
                          title="Bajar en el orden de turno"
                          className="p-1.5 rounded bg-studio-800 hover:bg-studio-700 disabled:opacity-30 text-blue-200"
                        >
                          <ArrowDown className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            if (window.confirm(`¿Expulsar a ${c.name} de la sala?`)) {
                              sendPresenterAction({ type: 'KICK_CONTESTANT', playerId: c.id });
                            }
                          }}
                          title="Expulsar participante"
                          className="p-1.5 rounded bg-red-600/20 hover:bg-red-600/50 text-red-300"
                        >
                          <UserX className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            <div className="p-3.5 rounded-xl bg-blue-950/60 border border-blue-400/25 flex flex-wrap items-center justify-between gap-2 text-xs text-blue-200">
              <span className="flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                Cada concursante dispone de su propio rosco de 27 letras y su cronómetro individual.
              </span>
              <span className="font-mono font-bold text-amber-300">
                Acierto: +{publicState.config.pointsCorrect} pts
              </span>
            </div>
          </div>
        </main>
      </div>
    );
  }

  // ==========================================================================
  // VISTA 1: PANTALLA INICIAL DE BIENVENIDA (ENTRAR A SALA O CREAR SALA)
  // ==========================================================================
  return (
    <div className="min-h-screen bg-gradient-to-b from-studio-800 via-studio-950 to-black text-white flex flex-col">
      {/* Cabecera de bienvenida */}
      <header className="px-4 sm:px-8 py-4 border-b border-blue-400/25 bg-studio-950/75 backdrop-blur-md flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-700 border-2 border-white/60 flex items-center justify-center shadow-rosco-blue">
            <ShieldCheck className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="font-display font-black text-xl sm:text-2xl tracking-wider text-white">
              PRL-ROSCO 3D
            </h1>
            <p className="text-xs text-blue-200">
              Concurso Televisivo Multijugador de Prevención de Riesgos Laborales
            </p>
          </div>
        </div>
        <AudioControlsBar />
      </header>

      {errorMessage && (
        <div
          data-testid="error-banner"
          className="max-w-5xl w-full mx-auto mt-4 px-4 py-3 rounded-xl bg-red-600/35 border border-red-400 text-red-100 flex items-center justify-between text-sm"
        >
          <div className="flex items-center gap-2">
            <AlertCircle className="w-5 h-5 shrink-0" />
            <span>{errorMessage}</span>
          </div>
          <button onClick={clearError} className="text-xs font-bold underline ml-4">
            Cerrar
          </button>
        </div>
      )}

      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-8 grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
        {/* Vista previa en directo del Escenario 3D y el Avatar configurable */}
        <div className="lg:col-span-6 space-y-4">
          <div className="rounded-3xl overflow-hidden border-2 border-blue-400/50 shadow-studio-glow h-[380px] sm:h-[470px] relative">
            <TVStudioStage3D
              activeContestant={{
                id: 'preview',
                name: playerNameInput.trim() || 'JAVIER',
                avatar: selectedAvatar,
                turnOrder: 1,
                status: 'ACTIVE',
                isConnected: true,
                currentLetter: 'A',
                lapCount: 1,
                letters: {} as any,
                timer: {
                  playerId: 'preview',
                  initialMs: 120000,
                  remainingMs: 120000,
                  consumedMs: 0,
                  isRunning: false,
                  lastServerSyncAt: Date.now(),
                },
                score: {
                  playerId: 'preview',
                  correctCount: 22,
                  incorrectCount: 0,
                  pasapalabraCount: 0,
                  pendingCount: 5,
                  totalPoints: 220,
                  timeConsumedMs: 0,
                  timeRemainingMs: 120000,
                  accuracyPct: 100,
                  rankPosition: 1,
                },
              }}
              activeLetter="A"
              characterAnimation="CONCENTRATION"
              cameraShot="ACTIVE_QUESTION"
              force2DFallback={force2DStage}
            />
            <div className="absolute top-3 left-3 px-3 py-1 rounded-full bg-studio-950/85 border border-blue-400/40 text-[11px] font-bold text-blue-200">
              PLATÓ 3D EN TIEMPO REAL · 27 LETRAS (A-Z, Ñ)
            </div>
          </div>
        </div>

        {/* Tarjeta de Acceso: Concursante o Presentador (Profesor) */}
        <div className="lg:col-span-6 p-6 sm:p-7 rounded-3xl bg-studio-900/90 border-2 border-blue-400/35 shadow-2xl space-y-6">
          {/* Selector de Rol */}
          <div className="grid grid-cols-2 gap-2 p-1.5 rounded-2xl bg-studio-950 border border-blue-400/25">
            <button
              type="button"
              data-testid="tab-contestant"
              onClick={() => setActiveTab('CONTESTANT')}
              className={`py-2.5 px-4 rounded-xl font-display font-extrabold text-xs sm:text-sm transition ${
                activeTab === 'CONTESTANT'
                  ? 'bg-blue-600 text-white shadow-rosco-blue'
                  : 'text-blue-200 hover:text-white'
              }`}
            >
              SOY CONCURSANTE (ALUMNO)
            </button>
            <button
              type="button"
              data-testid="tab-presenter"
              onClick={() => setActiveTab('PRESENTER')}
              className={`py-2.5 px-4 rounded-xl font-display font-extrabold text-xs sm:text-sm transition ${
                activeTab === 'PRESENTER'
                  ? 'bg-amber-500 text-studio-950 shadow-rosco-amber'
                  : 'text-blue-200 hover:text-white'
              }`}
            >
              SOY PRESENTADOR (PROFESOR)
            </button>
          </div>

          {activeTab === 'CONTESTANT' ? (
            <form onSubmit={handleJoinRoom} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-blue-200 mb-1.5">
                    Código de Sala
                  </label>
                  <input
                    required
                    data-testid="join-code-input"
                    type="text"
                    maxLength={8}
                    placeholder="Ej: PRL2025"
                    value={joinCodeInput}
                    onChange={(e) => setJoinCodeInput(e.target.value.toUpperCase())}
                    className="w-full px-4 py-2.5 rounded-xl bg-studio-950 border-2 border-blue-400/40 focus:border-blue-400 font-mono font-black text-lg tracking-widest uppercase text-white outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-blue-200 mb-1.5">
                    Tu Nombre o Alias
                  </label>
                  <input
                    required
                    data-testid="join-name-input"
                    type="text"
                    maxLength={24}
                    placeholder="Ej: Javier"
                    value={playerNameInput}
                    onChange={(e) => setPlayerNameInput(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-xl bg-studio-950 border-2 border-blue-400/40 focus:border-blue-400 font-bold text-base text-white outline-none"
                  />
                </div>
              </div>

              {/* Personalizador del Personaje 3D */}
              <div className="p-4 rounded-2xl bg-studio-950/75 border border-blue-400/25 space-y-3">
                <div className="text-xs font-bold uppercase tracking-wider text-blue-300">
                  Configura tu Personaje 3D
                </div>

                {/* Color de polo */}
                <div>
                  <span className="text-[11px] text-slate-300 block mb-1">Ropa de plató:</span>
                  <div className="flex flex-wrap gap-2">
                    {AVATAR_OUTFIT_COLORS.map((outfit) => (
                      <button
                        key={outfit.primary}
                        type="button"
                        onClick={() =>
                          setSelectedAvatar({
                            ...selectedAvatar,
                            outfitColor: outfit.primary,
                            collarColor: outfit.collar,
                          })
                        }
                        title={outfit.name}
                        style={{ backgroundColor: outfit.primary }}
                        className={`w-7 h-7 rounded-full border-2 transition ${
                          selectedAvatar.outfitColor === outfit.primary
                            ? 'border-white scale-115 ring-2 ring-blue-400'
                            : 'border-black/40 opacity-80'
                        }`}
                      />
                    ))}
                  </div>
                </div>

                {/* Tono de piel y color de pelo */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <span className="text-[11px] text-slate-300 block mb-1">Tono de piel:</span>
                    <div className="flex flex-wrap gap-1.5">
                      {AVATAR_SKIN_TONES.map((skin) => (
                        <button
                          key={skin}
                          type="button"
                          onClick={() =>
                            setSelectedAvatar({ ...selectedAvatar, skinColor: skin })
                          }
                          style={{ backgroundColor: skin }}
                          className={`w-6 h-6 rounded-full border-2 ${
                            selectedAvatar.skinColor === skin
                              ? 'border-white scale-110'
                              : 'border-transparent'
                          }`}
                        />
                      ))}
                    </div>
                  </div>

                  <div>
                    <span className="text-[11px] text-slate-300 block mb-1">Color de pelo:</span>
                    <div className="flex flex-wrap gap-1.5">
                      {AVATAR_HAIR_COLORS.map((hair) => (
                        <button
                          key={hair}
                          type="button"
                          onClick={() =>
                            setSelectedAvatar({ ...selectedAvatar, hairColor: hair })
                          }
                          style={{ backgroundColor: hair }}
                          className={`w-6 h-6 rounded-full border-2 ${
                            selectedAvatar.hairColor === hair
                              ? 'border-white scale-110'
                              : 'border-transparent'
                          }`}
                        />
                      ))}
                    </div>
                  </div>
                </div>

                {/* Peinado y Accesorio PRL */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <span className="text-[11px] text-slate-300 block mb-1">Peinado 3D:</span>
                    <select
                      value={selectedAvatar.hairStyle}
                      onChange={(e) =>
                        setSelectedAvatar({
                          ...selectedAvatar,
                          hairStyle: e.target.value as HairStyle,
                        })
                      }
                      className="w-full px-2.5 py-1.5 rounded-lg bg-studio-900 border border-blue-400/30 text-xs text-white"
                    >
                      <option value="parted">Raya lateral</option>
                      <option value="short">Corto clásico</option>
                      <option value="curly">Rizado</option>
                      <option value="bob">Melena media</option>
                      <option value="bun">Recogido</option>
                      <option value="spiky">Moderno</option>
                    </select>
                  </div>

                  <div>
                    <span className="text-[11px] text-slate-300 block mb-1">Accesorio:</span>
                    <select
                      value={selectedAvatar.accessory}
                      onChange={(e) =>
                        setSelectedAvatar({
                          ...selectedAvatar,
                          accessory: e.target.value as AvatarAccessory,
                        })
                      }
                      className="w-full px-2.5 py-1.5 rounded-lg bg-studio-900 border border-blue-400/30 text-xs text-white"
                    >
                      <option value="none">Sin accesorio</option>
                      <option value="glasses">Gafas</option>
                      <option value="helmet">Casco EPI de PRL</option>
                      <option value="headset">Auriculares de plató</option>
                    </select>
                  </div>
                </div>
              </div>

              <button
                type="submit"
                data-testid="join-room-submit"
                className="w-full py-3.5 rounded-2xl bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-400 hover:to-indigo-500 font-display font-black text-base tracking-wide text-white shadow-rosco-blue transition"
              >
                ENTRAR AL PLATÓ COMO CONCURSANTE
              </button>
            </form>
          ) : (
            <form onSubmit={handleCreateRoom} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold uppercase text-blue-200 mb-1">
                    Nombre de la Sala / Clase
                  </label>
                  <input
                    type="text"
                    value={roomNameInput}
                    onChange={(e) => setRoomNameInput(e.target.value)}
                    className="w-full px-3.5 py-2 rounded-xl bg-studio-950 border border-blue-400/40 text-sm text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase text-blue-200 mb-1">
                    Visibilidad de la Sala
                  </label>
                  <select
                    value={isPublicRoom ? 'PUBLIC' : 'PRIVATE'}
                    onChange={(e) => setIsPublicRoom(e.target.value === 'PUBLIC')}
                    className="w-full px-3.5 py-2 rounded-xl bg-studio-950 border border-blue-400/40 text-sm text-white"
                  >
                    <option value="PRIVATE">Sala Privada con Código Único</option>
                    <option value="PUBLIC">Sala Pública con Código</option>
                  </select>
                </div>
              </div>

              {/* Configuración del Cronómetro Individual por Concursante */}
              <div className="p-3.5 rounded-2xl bg-studio-950/75 border border-blue-400/25 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold uppercase text-amber-300 flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5" />
                    Cronómetro Individual por Concursante
                  </span>
                  <span className="text-[11px] text-blue-200">Recomendado: 120s</span>
                </div>

                <div className="flex flex-wrap gap-1.5">
                  {TIMER_PRESETS.map((sec) => (
                    <button
                      key={sec}
                      type="button"
                      onClick={() => {
                        setUseCustomTimer(false);
                        setTimerSeconds(sec);
                      }}
                      className={`px-3 py-1.5 rounded-lg text-xs font-mono font-bold transition ${
                        !useCustomTimer && timerSeconds === sec
                          ? 'bg-amber-500 text-studio-950 shadow'
                          : 'bg-studio-800 text-blue-200 hover:bg-studio-700'
                      }`}
                    >
                      {sec}s
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => setUseCustomTimer(true)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${
                      useCustomTimer
                        ? 'bg-amber-500 text-studio-950'
                        : 'bg-studio-800 text-blue-200'
                    }`}
                  >
                    Personalizado
                  </button>
                </div>

                {useCustomTimer && (
                  <div className="pt-1 flex items-center gap-2">
                    <input
                      type="number"
                      min={15}
                      max={900}
                      value={customTimerInput}
                      onChange={(e) => setCustomTimerInput(e.target.value)}
                      className="w-24 px-2.5 py-1 rounded-lg bg-studio-900 border border-amber-400 text-xs font-mono text-white"
                    />
                    <span className="text-xs text-slate-300">segundos por concursante</span>
                  </div>
                )}
              </div>

              {/* Puntuación y Dificultad */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold uppercase text-blue-200 mb-1 flex items-center gap-1">
                    <Award className="w-3.5 h-3.5 text-emerald-400" />
                    Puntos por Acierto
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={pointsCorrect}
                    onChange={(e) => setPointsCorrect(parseInt(e.target.value, 10) || 10)}
                    className="w-full px-3 py-2 rounded-xl bg-studio-950 border border-blue-400/40 text-sm font-mono text-white"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase text-blue-200 mb-1">
                    Dificultad de Preguntas
                  </label>
                  <select
                    value={selectedDifficulty}
                    onChange={(e) => setSelectedDifficulty(e.target.value as any)}
                    className="w-full px-3 py-2 rounded-xl bg-studio-950 border border-blue-400/40 text-sm text-white"
                  >
                    <option value="TODAS">Todas las dificultades</option>
                    <option value="FACIL">Fácil</option>
                    <option value="MEDIA">Media</option>
                    <option value="DIFICIL">Difícil</option>
                  </select>
                </div>
              </div>

              {/* Selector de las 24 categorías PRL */}
              <div>
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="font-bold text-blue-200">
                    Categorías PRL ({selectedCategories.length === 0 ? 'Todas (24)' : selectedCategories.length})
                  </span>
                  {selectedCategories.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setSelectedCategories([])}
                      className="text-[11px] text-amber-300 underline"
                    >
                      Incluir todas
                    </button>
                  )}
                </div>
                <div className="max-h-24 overflow-y-auto p-2 rounded-xl bg-studio-950 border border-blue-400/25 flex flex-wrap gap-1">
                  {PRL_CATEGORIES.map((cat) => {
                    const active = selectedCategories.includes(cat);
                    return (
                      <button
                        key={cat}
                        type="button"
                        onClick={() => toggleCategory(cat)}
                        className={`px-2 py-0.5 rounded text-[10px] font-semibold transition ${
                          active
                            ? 'bg-blue-600 text-white'
                            : 'bg-studio-800/80 text-slate-300 hover:bg-studio-700'
                        }`}
                      >
                        {cat}
                      </button>
                    );
                  })}
                </div>
              </div>

              <button
                type="submit"
                data-testid="create-room-submit"
                className="w-full py-3.5 rounded-2xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 font-display font-black text-base tracking-wide text-studio-950 shadow-rosco-amber transition"
              >
                CREAR SALA Y ABRIR CABINA DEL PRESENTADOR
              </button>
            </form>
          )}
        </div>
      </main>
    </div>
  );
};
