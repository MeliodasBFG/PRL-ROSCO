import React, { useMemo, useState } from 'react';
import {
  CheckCircle2,
  XCircle,
  FastForward,
  Pause,
  Play,
  RotateCcw,
  Eye,
  BookOpen,
  Clock,
  Users,
  Trophy,
  AlertTriangle,
  ExternalLink,
  Volume2,
  SkipForward,
  UserCheck,
  UserX,
  Grid,
  History,
  RefreshCw,
} from 'lucide-react';
import { useRoscoStore } from '../../store/useRoscoStore';
import { TVStudioStage3D } from '../studio3d/TVStudioStage3D';
import { BroadcastTimerBadge } from '../ui/BroadcastTimerBadge';
import { MiniRosco2D } from '../ui/MiniRosco2D';
import { AudioControlsBar } from '../ui/AudioControlsBar';
import { QrCodeInviteCard } from '../ui/QrCodeInviteCard';
import { QuestionBankAdminModal } from './QuestionBankAdminModal';

export const PresenterScreen: React.FC = () => {
  const {
    publicState,
    presenterPrivate,
    displayRemainingMs,
    errorMessage,
    clearError,
    sendPresenterAction,
    leaveRoom,
    force2DStage,
    setForce2DStage,
  } = useRoscoStore();

  const [showAllRoscosModal, setShowAllRoscosModal] = useState(false);
  const [showQuestionBankModal, setShowQuestionBankModal] = useState(false);
  const [showAuditModal, setShowAuditModal] = useState(false);
  const [showQrModal, setShowQrModal] = useState(false);
  const [selectedTransferPlayerId, setSelectedTransferPlayerId] = useState<string>('');
  const [actionBusy, setActionBusy] = useState(false);

  const activeContestant = useMemo(() => {
    if (!publicState || !publicState.activePlayerId) return null;
    return (
      publicState.contestants.find((c) => c.id === publicState.activePlayerId) ?? null
    );
  }, [publicState]);

  // Candidatos disponibles para recibir el turno cuando se cede tras Pasapalabra
  const availableNextContestants = useMemo(() => {
    if (!publicState) return [];
    return publicState.contestants.filter(
      (c) =>
        c.id !== publicState.activePlayerId &&
        c.status !== 'FINISHED' &&
        c.status !== 'KICKED' &&
        c.status !== 'ABSENT' &&
        c.timer.remainingMs > 0 &&
        c.score.pendingCount > 0
    );
  }, [publicState]);

  if (!publicState) return null;

  const activeLetter = publicState.activeLetter;
  const activeQuestionPublic = publicState.activeQuestion;
  const activeQuestionPrivate = presenterPrivate?.activeQuestionPrivate ?? null;

  const canAnswer =
    publicState.status === 'PLAYING' &&
    Boolean(activeContestant) &&
    Boolean(activeLetter) &&
    Boolean(activeQuestionPublic) &&
    !publicState.awaitingPasapalabraDecision &&
    !actionBusy;

  const runGuardedAction = async (fn: () => Promise<boolean>) => {
    if (actionBusy) return;
    setActionBusy(true);
    try {
      await fn();
    } finally {
      setActionBusy(false);
    }
  };

  const handleMarkCorrect = () => {
    if (!canAnswer || !activeContestant || !activeLetter || !activeQuestionPublic) return;
    runGuardedAction(() =>
      sendPresenterAction({
        type: 'MARK_CORRECT',
        expectedPlayerId: activeContestant.id,
        expectedLetter: activeLetter,
        expectedQuestionId: activeQuestionPublic.id,
      })
    );
  };

  const handleMarkIncorrect = () => {
    if (!canAnswer || !activeContestant || !activeLetter || !activeQuestionPublic) return;
    runGuardedAction(() =>
      sendPresenterAction({
        type: 'MARK_INCORRECT',
        expectedPlayerId: activeContestant.id,
        expectedLetter: activeLetter,
        expectedQuestionId: activeQuestionPublic.id,
      })
    );
  };

  const handleRegisterPasapalabra = () => {
    if (!canAnswer || !activeContestant || !activeLetter || !activeQuestionPublic) return;
    const defaultNext = availableNextContestants[0]?.id || '';
    setSelectedTransferPlayerId(defaultNext);
    runGuardedAction(() =>
      sendPresenterAction({
        type: 'REGISTER_PASAPALABRA',
        expectedPlayerId: activeContestant.id,
        expectedLetter: activeLetter,
        expectedQuestionId: activeQuestionPublic.id,
      })
    );
  };

  const handlePasapalabraContinueSame = () => {
    runGuardedAction(() =>
      sendPresenterAction({
        type: 'PASAPALABRA_DECISION',
        decision: 'CONTINUE_SAME',
      })
    );
  };

  const handlePasapalabraTransferTurn = () => {
    const targetId = selectedTransferPlayerId || availableNextContestants[0]?.id;
    runGuardedAction(() =>
      sendPresenterAction({
        type: 'PASAPALABRA_DECISION',
        decision: 'TRANSFER_TURN',
        nextPlayerId: targetId,
      })
    );
  };

  return (
    <div
      data-testid="presenter-screen"
      className="min-h-screen bg-gradient-to-b from-studio-900 via-studio-950 to-black text-white flex flex-col"
    >
      {/* CABECERA EXCLUSIVA DEL PRESENTADOR */}
      <header className="px-4 py-2.5 bg-studio-950/95 border-b border-amber-400/35 flex flex-wrap items-center justify-between gap-2 z-30">
        <div className="flex items-center gap-3">
          <span className="px-3 py-1 rounded-lg bg-amber-500 text-studio-950 font-display font-black text-xs tracking-wider shadow">
            CABINA DEL PRESENTADOR
          </span>
          <span className="font-mono font-bold text-sm text-blue-200">
            SALA: <strong className="text-white">{publicState.roomCode}</strong>
          </span>
          <span className="text-xs text-slate-400 hidden sm:inline">
            Ronda #{publicState.roundNumber} · {publicState.contestants.length}/15 concursantes
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setShowQrModal(true)}
            className="px-2.5 py-1.5 rounded-lg bg-studio-800 hover:bg-studio-700 border border-blue-400/30 text-xs font-bold text-blue-200"
          >
            Código / QR
          </button>
          <button
            type="button"
            onClick={() => setShowAllRoscosModal(true)}
            className="px-2.5 py-1.5 rounded-lg bg-studio-800 hover:bg-studio-700 border border-blue-400/30 text-xs font-bold text-blue-200 flex items-center gap-1"
          >
            <Grid className="w-3.5 h-3.5" />
            Todos los Roscos
          </button>
          <button
            type="button"
            onClick={() => setShowQuestionBankModal(true)}
            className="px-2.5 py-1.5 rounded-lg bg-studio-800 hover:bg-studio-700 border border-blue-400/30 text-xs font-bold text-amber-300 flex items-center gap-1"
          >
            <BookOpen className="w-3.5 h-3.5" />
            Banco PRL
          </button>
          <button
            type="button"
            onClick={() => setShowAuditModal(true)}
            className="px-2.5 py-1.5 rounded-lg bg-studio-800 hover:bg-studio-700 border border-blue-400/30 text-xs font-bold text-blue-200 flex items-center gap-1"
          >
            <History className="w-3.5 h-3.5" />
            Auditoría
          </button>
          <button
            type="button"
            onClick={() => setForce2DStage(!force2DStage)}
            className="px-2.5 py-1.5 rounded-lg bg-studio-800 hover:bg-studio-700 border border-blue-400/30 text-xs font-semibold text-slate-300"
          >
            {force2DStage ? 'Modo 3D' : 'Modo 2D'}
          </button>
          <AudioControlsBar />
          <button
            type="button"
            onClick={leaveRoom}
            className="px-2.5 py-1.5 rounded-lg bg-red-600/25 hover:bg-red-600/45 border border-red-400/40 text-xs font-bold text-red-200"
          >
            Salir
          </button>
        </div>
      </header>

      {errorMessage && (
        <div className="mx-4 mt-2 px-4 py-2 rounded-xl bg-red-600/35 border border-red-400 text-xs sm:text-sm text-red-100 flex items-center justify-between">
          <span>{errorMessage}</span>
          <button onClick={clearError} className="underline font-bold ml-4">
            Cerrar
          </button>
        </div>
      )}

      {/* CUERPO PRINCIPAL DE LA CABINA DEL PRESENTADOR */}
      <main className="flex-1 max-w-[1600px] w-full mx-auto p-3 sm:p-4 grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* ZONA 1 (Izquierda / Centro): ESCENARIO 3D + TARJETA DE PREGUNTA + 3 BOTONES GRANDES */}
        <div className="lg:col-span-7 flex flex-col gap-3">
          {/* Escenario 3D del Plató con HUD de Cronómetro y Marcadores */}
          <div className="relative rounded-2xl overflow-hidden border-2 border-blue-400/45 shadow-studio-glow h-[360px] sm:h-[430px]">
            <TVStudioStage3D
              activeContestant={activeContestant}
              activeLetter={activeLetter}
              characterAnimation={publicState.characterAnimation}
              cameraShot={publicState.cameraShot}
              isGameFinished={publicState.status === 'FINISHED'}
              allContestants={publicState.contestants}
              leaderboard={publicState.leaderboard}
              force2DFallback={force2DStage}
            />

            {/* Esquina superior izquierda: Información del concursante activo */}
            <div className="absolute top-3 left-3 flex flex-wrap items-center gap-2">
              <div className="px-3.5 py-1.5 rounded-xl bg-studio-950/90 border border-blue-400/45 backdrop-blur-md flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping" />
                <span className="text-xs font-bold uppercase text-blue-200">EN PLATÓ:</span>
                <span
                  data-testid="active-contestant-name"
                  className="font-display font-black text-sm sm:text-base text-white"
                >
                  {activeContestant?.name || 'Ninguno'}
                </span>
              </div>

              {activeContestant && (
                <div className="px-3 py-1.5 rounded-xl bg-studio-950/90 border border-blue-400/35 backdrop-blur-md flex items-center gap-3 text-xs font-bold">
                  <span className="text-amber-300">
                    {activeContestant.score.totalPoints} PTS
                  </span>
                  <span className="text-emerald-400">
                    ✓ {activeContestant.score.correctCount}
                  </span>
                  <span className="text-red-400">
                    ✗ {activeContestant.score.incorrectCount}
                  </span>
                  <span className="text-blue-200">
                    Pend: {activeContestant.score.pendingCount}
                  </span>
                </div>
              )}
            </div>

            {/* Esquina inferior izquierda: Cronómetro circular naranja + Contador verde (como en la foto) */}
            {activeContestant && (
              <div className="absolute bottom-3 left-3">
                <BroadcastTimerBadge
                  remainingMs={displayRemainingMs}
                  initialMs={activeContestant.timer.initialMs}
                  correctCount={activeContestant.score.correctCount}
                  isRunning={activeContestant.timer.isRunning && publicState.status === 'PLAYING'}
                  playerName={activeContestant.name}
                />
              </div>
            )}

            {/* Esquina inferior derecha: Letra activa gigante */}
            {activeLetter && (
              <div className="absolute bottom-3 right-3 flex items-center gap-2">
                <div
                  data-testid="active-letter-badge"
                  className="w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-gradient-to-b from-blue-400 to-blue-700 border-4 border-white shadow-rosco-blue flex flex-col items-center justify-center"
                >
                  <span className="text-[9px] font-bold uppercase tracking-wider text-blue-100">
                    LETRA
                  </span>
                  <span className="font-display font-black text-2xl sm:text-3xl leading-none text-white">
                    {activeLetter}
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* TARJETA DE PREGUNTA ACTIVA PARA LEER EN VOZ ALTA */}
          <div className="p-4 rounded-2xl bg-studio-900/95 border-2 border-blue-400/40 shadow-xl space-y-2">
            {activeQuestionPublic ? (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="px-3 py-1 rounded-lg bg-blue-600 font-display font-black text-xs sm:text-sm text-white shadow">
                      {activeQuestionPublic.mode === 'EMPIEZA_POR'
                        ? `EMPIEZA POR LA ${activeQuestionPublic.letter}`
                        : `CONTIENE LA ${activeQuestionPublic.letter}`}
                    </span>
                    <span className="px-2.5 py-1 rounded-lg bg-studio-800 border border-blue-400/30 text-xs font-semibold text-blue-200">
                      {activeQuestionPublic.category}
                    </span>
                  </div>
                  <span className="text-xs font-bold uppercase text-amber-300">
                    Dificultad: {activeQuestionPublic.difficulty}
                  </span>
                </div>

                <p
                  data-testid="active-question-statement"
                  className="text-base sm:text-xl font-bold text-white leading-snug pt-1"
                >
                  {activeQuestionPublic.statement}
                </p>
              </>
            ) : (
              <div className="py-4 text-center text-sm text-blue-200">
                {publicState.status === 'FINISHED'
                  ? '¡Partida finalizada! Consulta el podio 3D y la clasificación definitiva.'
                  : 'Selecciona un concursante o reanuda la partida para activar la pregunta.'}
              </div>
            )}
          </div>

          {/* ZONA DE CONTROL DE RESPUESTAS: 3 BOTONES GRANDES EXCLUSIVOS DEL PRESENTADOR */}
          <div
            data-testid="presenter-answer-controls"
            className="grid grid-cols-1 sm:grid-cols-3 gap-3"
          >
            {/* BOTÓN VERDE: ACIERTO */}
            <button
              type="button"
              data-testid="btn-mark-correct"
              disabled={!canAnswer}
              onClick={handleMarkCorrect}
              className={`py-4 px-5 rounded-2xl font-display font-black text-lg sm:text-xl tracking-wide flex items-center justify-center gap-2.5 border-2 transition ${
                canAnswer
                  ? 'bg-gradient-to-b from-emerald-400 to-emerald-600 hover:from-emerald-300 hover:to-emerald-500 border-emerald-200 text-white shadow-rosco-green cursor-pointer active:scale-98'
                  : 'bg-slate-800/70 border-slate-700 text-slate-500 cursor-not-allowed'
              }`}
            >
              <CheckCircle2 className="w-7 h-7" />
              ACIERTO (+{publicState.config.pointsCorrect})
            </button>

            {/* BOTÓN ROJO: FALLO */}
            <button
              type="button"
              data-testid="btn-mark-incorrect"
              disabled={!canAnswer}
              onClick={handleMarkIncorrect}
              className={`py-4 px-5 rounded-2xl font-display font-black text-lg sm:text-xl tracking-wide flex items-center justify-center gap-2.5 border-2 transition ${
                canAnswer
                  ? 'bg-gradient-to-b from-red-500 to-red-700 hover:from-red-400 hover:to-red-600 border-red-200 text-white shadow-rosco-red cursor-pointer active:scale-98'
                  : 'bg-slate-800/70 border-slate-700 text-slate-500 cursor-not-allowed'
              }`}
            >
              <XCircle className="w-7 h-7" />
              FALLO
            </button>

            {/* BOTÓN AZUL: PASAPALABRA */}
            <button
              type="button"
              data-testid="btn-register-pasapalabra"
              disabled={!canAnswer}
              onClick={handleRegisterPasapalabra}
              className={`py-4 px-5 rounded-2xl font-display font-black text-lg sm:text-xl tracking-wide flex items-center justify-center gap-2.5 border-2 transition ${
                canAnswer
                  ? 'bg-gradient-to-b from-blue-500 to-blue-700 hover:from-blue-400 hover:to-blue-600 border-blue-200 text-white shadow-rosco-blue cursor-pointer active:scale-98'
                  : 'bg-slate-800/70 border-slate-700 text-slate-500 cursor-not-allowed'
              }`}
            >
              <FastForward className="w-7 h-7" />
              PASAPALABRA
            </button>
          </div>
        </div>

        {/* ZONA 2 (Derecha): INFORMACIÓN PRIVADA DEL PRESENTADOR + GESTIÓN DE TURNOS Y CRONÓMETRO */}
        <div className="lg:col-span-5 flex flex-col gap-3">
          {/* PANEL ESPECIAL DE DECISIÓN DE PASAPALABRA (Sección 6) */}
          {publicState.awaitingPasapalabraDecision && activeContestant && (
            <div
              data-testid="pasapalabra-decision-panel"
              className="p-4 rounded-2xl bg-gradient-to-br from-amber-500/25 via-studio-900 to-studio-950 border-2 border-amber-400 shadow-rosco-amber space-y-3 animate-fadeIn"
            >
              <div className="flex items-center gap-2 text-amber-300 font-display font-black text-sm sm:text-base">
                <AlertTriangle className="w-5 h-5 shrink-0" />
                DECISIÓN DEL PRESENTADOR TRAS PASAPALABRA (LETRA {activeLetter})
              </div>
              <p className="text-xs text-blue-100">
                La letra <strong>{activeLetter}</strong> de{' '}
                <strong>{activeContestant.name}</strong> ha quedado en amarillo/pendiente y su
                cronómetro está congelado en{' '}
                <strong>{Math.ceil(displayRemainingMs / 1000)}s</strong>. Elige qué sucede ahora:
              </p>

              <div className="grid grid-cols-1 gap-2.5">
                {/* OPCIÓN 1: CONTINUAR CON EL MISMO CONCURSANTE */}
                <button
                  type="button"
                  data-testid="btn-pasapalabra-continue-same"
                  onClick={handlePasapalabraContinueSame}
                  className="w-full p-3.5 rounded-xl bg-blue-600 hover:bg-blue-500 border border-blue-300 text-left flex items-center justify-between gap-3 shadow transition"
                >
                  <div>
                    <div className="font-display font-black text-sm text-white">
                      OPCIÓN 1: CONTINUAR CON {activeContestant.name.toUpperCase()}
                    </div>
                    <div className="text-[11px] text-blue-100">
                      Conserva su turno, su cronómetro sigue descontando y avanza a su siguiente
                      letra pendiente.
                    </div>
                  </div>
                  <Play className="w-5 h-5 text-white shrink-0" />
                </button>

                {/* OPCIÓN 2: CEDER EL TURNO A OTRO CONCURSANTE */}
                <div className="p-3.5 rounded-xl bg-amber-500/20 border border-amber-400/60 space-y-2.5">
                  <div className="font-display font-black text-sm text-amber-300">
                    OPCIÓN 2: CEDER EL TURNO A OTRO CONCURSANTE
                  </div>
                  <p className="text-[11px] text-amber-100">
                    Pausa y guarda el tiempo de {activeContestant.name} (
                    {Math.ceil(displayRemainingMs / 1000)}s) y presenta en plató al concursante
                    seleccionado con su propio rosco y tiempo:
                  </p>

                  {availableNextContestants.length > 0 ? (
                    <div className="space-y-2">
                      <select
                        data-testid="pasapalabra-next-player-select"
                        value={selectedTransferPlayerId || availableNextContestants[0]?.id || ''}
                        onChange={(e) => setSelectedTransferPlayerId(e.target.value)}
                        className="w-full px-3 py-2 rounded-lg bg-studio-950 border border-amber-400 text-xs font-bold text-white"
                      >
                        {availableNextContestants.map((c) => (
                          <option key={c.id} value={c.id}>
                            Pasar turno a: #{c.turnOrder} {c.name} (Letra {c.currentLetter} ·{' '}
                            {Math.ceil(c.timer.remainingMs / 1000)}s restantes ·{' '}
                            {c.score.pendingCount} pend.)
                          </option>
                        ))}
                      </select>

                      <button
                        type="button"
                        data-testid="btn-pasapalabra-transfer-turn"
                        onClick={handlePasapalabraTransferTurn}
                        className="w-full py-2.5 px-4 rounded-xl bg-amber-500 hover:bg-amber-400 font-display font-black text-xs sm:text-sm text-studio-950 flex items-center justify-center gap-2 shadow"
                      >
                        <UserCheck className="w-4 h-4" />
                        CONFIRMAR CESIÓN DE TURNO AL CONCURSANTE SELECCIONADO
                      </button>
                    </div>
                  ) : (
                    <div className="text-xs text-amber-200 italic">
                      No hay otros concursantes con rosco pendiente en la sala; pulsa la Opción 1
                      para continuar.
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* INFORMACIÓN PRIVADA EXCLUSIVA DEL PRESENTADOR (Sección 5) */}
          <div
            data-testid="presenter-private-panel"
            className="p-4 rounded-2xl bg-studio-900/95 border-2 border-amber-400/45 shadow-xl space-y-2.5"
          >
            <div className="flex items-center justify-between border-b border-amber-400/20 pb-2">
              <span className="text-xs font-display font-black uppercase tracking-wider text-amber-300 flex items-center gap-1.5">
                <Eye className="w-4 h-4" />
                SOLUCIÓN PRIVADA DEL PRESENTADOR (OCULTA A CONCURSANTES)
              </span>
              {activeQuestionPrivate && (
                <span className="font-mono text-[11px] text-blue-300">
                  ID: {activeQuestionPrivate.id}
                </span>
              )}
            </div>

            {activeQuestionPrivate ? (
              <div className="space-y-2 text-xs">
                <div className="p-2.5 rounded-xl bg-emerald-950/70 border border-emerald-400/50 flex flex-wrap items-baseline justify-between gap-2">
                  <div>
                    <span className="text-[10px] font-bold uppercase text-emerald-300 block">
                      RESPUESTA PRINCIPAL CORRECTA:
                    </span>
                    <span
                      data-testid="private-main-answer"
                      className="font-display font-black text-lg sm:text-xl text-white"
                    >
                      {activeQuestionPrivate.mainAnswer}
                    </span>
                  </div>
                  <div className="text-right">
                    <span className="text-[10px] text-emerald-200 block">
                      Revisado: {activeQuestionPrivate.reviewedAt}
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <div className="p-2 rounded-lg bg-studio-950/80 border border-blue-400/20">
                    <span className="text-[10px] font-bold uppercase text-blue-300 block">
                      Variantes aceptadas:
                    </span>
                    <span className="text-white font-semibold">
                      {activeQuestionPrivate.acceptedVariants.length > 0
                        ? activeQuestionPrivate.acceptedVariants.join(' · ')
                        : 'Ninguna adicional'}
                    </span>
                  </div>
                  <div className="p-2 rounded-lg bg-studio-950/80 border border-blue-400/20">
                    <span className="text-[10px] font-bold uppercase text-blue-300 block">
                      Sinónimos autorizados:
                    </span>
                    <span className="text-white font-semibold">
                      {activeQuestionPrivate.synonyms.length > 0
                        ? activeQuestionPrivate.synonyms.join(' · ')
                        : 'Ninguno adicional'}
                    </span>
                  </div>
                </div>

                <div className="p-2.5 rounded-lg bg-studio-950/80 border border-blue-400/20 space-y-1">
                  <span className="text-[10px] font-bold uppercase text-amber-300 block">
                    Explicación Técnica de PRL:
                  </span>
                  <p className="text-slate-200 leading-relaxed">
                    {activeQuestionPrivate.explanation}
                  </p>
                  <div className="pt-1 flex flex-wrap items-center justify-between gap-2 text-[11px] text-blue-300 border-t border-blue-400/15">
                    <span>Fuente: {activeQuestionPrivate.source}</span>
                    <a
                      href={activeQuestionPrivate.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-amber-300 hover:underline font-bold"
                    >
                      Referencia BOE / INSST <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                </div>
              </div>
            ) : (
              <div className="py-3 text-xs text-slate-400 text-center">
                No hay pregunta activa en este instante.
              </div>
            )}

            {/* Botones de revelación deliberada, repetición y deshacer */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 pt-1">
              <button
                type="button"
                onClick={() => sendPresenterAction({ type: 'REPEAT_QUESTION' })}
                className="px-2.5 py-2 rounded-lg bg-studio-800 hover:bg-studio-700 border border-blue-400/30 text-[11px] font-bold text-blue-100 flex items-center justify-center gap-1"
              >
                <Volume2 className="w-3.5 h-3.5" />
                Repetir Pregunta
              </button>
              <button
                type="button"
                data-testid="btn-reveal-answer"
                onClick={() => sendPresenterAction({ type: 'REVEAL_ANSWER' })}
                className="px-2.5 py-2 rounded-lg bg-emerald-600/30 hover:bg-emerald-600/50 border border-emerald-400/40 text-[11px] font-bold text-emerald-200 flex items-center justify-center gap-1"
              >
                <Eye className="w-3.5 h-3.5" />
                Revelar Respuesta
              </button>
              <button
                type="button"
                data-testid="btn-show-explanation"
                onClick={() => sendPresenterAction({ type: 'SHOW_EXPLANATION' })}
                className="px-2.5 py-2 rounded-lg bg-amber-600/30 hover:bg-amber-600/50 border border-amber-400/40 text-[11px] font-bold text-amber-200 flex items-center justify-center gap-1"
              >
                <BookOpen className="w-3.5 h-3.5" />
                Mostrar Explicación
              </button>
              <button
                type="button"
                onClick={() => sendPresenterAction({ type: 'NEXT_LETTER' })}
                className="px-2.5 py-2 rounded-lg bg-studio-800 hover:bg-studio-700 border border-blue-400/30 text-[11px] font-bold text-blue-100 flex items-center justify-center gap-1"
              >
                <SkipForward className="w-3.5 h-3.5" />
                Siguiente Letra
              </button>
            </div>
          </div>

          {/* CONTROLES DE TIEMPO, PARTIDA Y DESHACER ÚLTIMA ACCIÓN */}
          <div className="p-4 rounded-2xl bg-studio-900/90 border border-blue-400/35 shadow-xl space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-display font-black uppercase text-blue-200 flex items-center gap-1.5">
                <Clock className="w-4 h-4 text-amber-400" />
                CONTROL DE CRONÓMETRO Y PARTIDA
              </span>

              {/* Botón Deshacer última acción con auditoría */}
              <button
                type="button"
                data-testid="btn-undo-last-action"
                disabled={!presenterPrivate?.canUndo}
                onClick={() => {
                  if (
                    window.confirm(
                      `¿Deshacer la última acción del presentador ("${presenterPrivate?.lastUndoableDescription}")?`
                    )
                  ) {
                    sendPresenterAction({ type: 'UNDO_LAST_ACTION' });
                  }
                }}
                className={`px-3 py-1 rounded-lg text-xs font-bold flex items-center gap-1 border transition ${
                  presenterPrivate?.canUndo
                    ? 'bg-amber-500/25 hover:bg-amber-500/40 border-amber-400 text-amber-200 cursor-pointer'
                    : 'bg-slate-800/50 border-slate-700 text-slate-500 cursor-not-allowed'
                }`}
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Deshacer última acción
              </button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {publicState.status === 'PLAYING' ? (
                <button
                  type="button"
                  data-testid="btn-pause-game"
                  onClick={() => sendPresenterAction({ type: 'PAUSE_GAME' })}
                  className="px-3 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-xs font-bold text-white flex items-center justify-center gap-1.5"
                >
                  <Pause className="w-4 h-4" />
                  Pausar Partida
                </button>
              ) : (
                <button
                  type="button"
                  data-testid="btn-resume-game"
                  onClick={() => sendPresenterAction({ type: 'RESUME_GAME' })}
                  className="px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-xs font-bold text-white flex items-center justify-center gap-1.5"
                >
                  <Play className="w-4 h-4" />
                  Reanudar Partida
                </button>
              )}

              {activeContestant && activeContestant.timer.isRunning ? (
                <button
                  type="button"
                  onClick={() => sendPresenterAction({ type: 'PAUSE_TIMER' })}
                  className="px-3 py-2 rounded-xl bg-studio-800 hover:bg-studio-700 border border-blue-400/30 text-xs font-bold text-blue-100"
                >
                  Pausar Reloj
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => sendPresenterAction({ type: 'RESUME_TIMER' })}
                  className="px-3 py-2 rounded-xl bg-studio-800 hover:bg-studio-700 border border-blue-400/30 text-xs font-bold text-emerald-300"
                >
                  Reanudar Reloj
                </button>
              )}

              <button
                type="button"
                disabled={!activeContestant}
                onClick={() =>
                  activeContestant &&
                  sendPresenterAction({
                    type: 'ADD_TIME',
                    playerId: activeContestant.id,
                    deltaSeconds: 15,
                  })
                }
                className="px-3 py-2 rounded-xl bg-studio-800 hover:bg-studio-700 border border-blue-400/30 text-xs font-bold text-blue-200 disabled:opacity-40"
              >
                +15s al jugador
              </button>

              <button
                type="button"
                disabled={!activeContestant}
                onClick={() => {
                  if (
                    activeContestant &&
                    window.confirm(
                      `¿Finalizar manualmente el turno de ${activeContestant.name}?`
                    )
                  ) {
                    sendPresenterAction({
                      type: 'FINISH_PLAYER_TURN',
                      playerId: activeContestant.id,
                    });
                  }
                }}
                className="px-3 py-2 rounded-xl bg-red-600/30 hover:bg-red-600/50 border border-red-400/40 text-xs font-bold text-red-200 disabled:opacity-40"
              >
                Finalizar Turno
              </button>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-blue-400/15">
              <button
                type="button"
                onClick={() =>
                  sendPresenterAction({
                    type: 'TOGGLE_LEADERBOARD',
                    visible: !publicState.config.showLeaderboardDuringGame,
                  })
                }
                className="px-3 py-1.5 rounded-lg bg-studio-800 hover:bg-studio-700 text-xs font-semibold text-blue-200 flex items-center gap-1"
              >
                <Trophy className="w-3.5 h-3.5 text-amber-400" />
                {publicState.config.showLeaderboardDuringGame
                  ? 'Ocultar Clasificación a Alumnos'
                  : 'Mostrar Clasificación a Alumnos'}
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    if (
                      window.confirm(
                        '¿Reiniciar una nueva ronda con 27 preguntas nuevas para todos los concursantes?'
                      )
                    ) {
                      sendPresenterAction({ type: 'RESET_ROUND' });
                    }
                  }}
                  className="px-3 py-1.5 rounded-lg bg-studio-800 hover:bg-studio-700 text-xs font-semibold text-amber-300 flex items-center gap-1"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  Nueva Ronda
                </button>

                <button
                  type="button"
                  onClick={() => {
                    if (
                      window.confirm(
                        '¿Finalizar la partida y mostrar el Podio 3D definitivo?'
                      )
                    ) {
                      sendPresenterAction({ type: 'FINISH_GAME' });
                    }
                  }}
                  className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-xs font-black text-studio-950"
                >
                  Finalizar Partida
                </button>
              </div>
            </div>
          </div>

          {/* LISTA DE LOS 15 CONCURSANTES Y SELECTOR DE TURNO EN DIRECTO */}
          <div className="p-4 rounded-2xl bg-studio-900/90 border border-blue-400/35 shadow-xl flex-1 flex flex-col min-h-[210px]">
            <div className="flex items-center justify-between border-b border-blue-400/20 pb-2 mb-2">
              <span className="text-xs font-display font-black uppercase text-white flex items-center gap-1.5">
                <Users className="w-4 h-4 text-blue-400" />
                TURNO Y ESTADO DE CONCURSANTES ({publicState.contestants.length}/15)
              </span>
              <span className="text-[11px] text-blue-300">
                Pulsa "Dar Turno" para presentar a otro concursante
              </span>
            </div>

            <div className="space-y-1.5 overflow-y-auto max-h-[250px] pr-1">
              {publicState.contestants.map((c) => {
                const isActive = c.id === publicState.activePlayerId;
                const remSec = Math.ceil(
                  (isActive ? displayRemainingMs : c.timer.remainingMs) / 1000
                );
                const canSelect =
                  !isActive &&
                  c.status !== 'FINISHED' &&
                  c.timer.remainingMs > 0 &&
                  c.score.pendingCount > 0;

                return (
                  <div
                    key={c.id}
                    data-testid={`presenter-player-row-${c.name}`}
                    className={`p-2.5 rounded-xl border flex items-center justify-between gap-2 transition ${
                      isActive
                        ? 'bg-blue-600/35 border-blue-300 shadow-rosco-blue'
                        : 'bg-studio-950/75 border-blue-400/20'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className="w-6 h-6 rounded-full bg-studio-800 font-mono font-bold text-xs flex items-center justify-center text-blue-200 shrink-0">
                        {c.turnOrder}
                      </span>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="font-bold text-xs sm:text-sm text-white truncate">
                            {c.name}
                          </span>
                          <span
                            className={`w-2 h-2 rounded-full ${
                              c.isConnected ? 'bg-emerald-400' : 'bg-red-400'
                            }`}
                          />
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-studio-800 text-blue-200">
                            {isActive
                              ? 'JUGANDO'
                              : c.status === 'FINISHED'
                              ? 'TERMINADO'
                              : c.status === 'PAUSED'
                              ? `EN PAUSA (${c.currentLetter})`
                              : c.status === 'ABSENT'
                              ? 'AUSENTE'
                              : 'ESPERANDO'}
                          </span>
                        </div>
                        <div className="text-[11px] text-blue-200 flex items-center gap-2">
                          <span className="font-mono font-bold text-amber-300">
                            {c.score.totalPoints} pts
                          </span>
                          <span className="text-emerald-400">✓{c.score.correctCount}</span>
                          <span className="text-red-400">✗{c.score.incorrectCount}</span>
                          <span>Pend:{c.score.pendingCount}</span>
                          <span className="font-mono text-white">⏱ {remSec}s</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      {canSelect && (
                        <button
                          type="button"
                          data-testid={`btn-select-player-${c.name}`}
                          onClick={() =>
                            sendPresenterAction({
                              type: 'SELECT_CONTESTANT',
                              playerId: c.id,
                            })
                          }
                          className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-[11px] font-bold text-white shadow"
                        >
                          Dar Turno
                        </button>
                      )}
                      {c.status !== 'FINISHED' && (
                        <button
                          type="button"
                          title="Saltar por ausencia"
                          onClick={() =>
                            sendPresenterAction({
                              type: 'SKIP_ABSENT_CONTESTANT',
                              playerId: c.id,
                            })
                          }
                          className="px-2 py-1 rounded-lg bg-studio-800 hover:bg-studio-700 text-[10px] text-amber-300"
                        >
                          Ausente
                        </button>
                      )}
                      <button
                        type="button"
                        title="Expulsar participante"
                        onClick={() => {
                          if (window.confirm(`¿Expulsar a ${c.name} de la partida?`)) {
                            sendPresenterAction({
                              type: 'KICK_CONTESTANT',
                              playerId: c.id,
                            });
                          }
                        }}
                        className="p-1 rounded-lg bg-red-600/20 hover:bg-red-600/40 text-red-300"
                      >
                        <UserX className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </main>

      {/* MODAL: VER TODOS LOS ROSCOS DE LOS 15 CONCURSANTES */}
      {showAllRoscosModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="w-full max-w-6xl max-h-[88vh] bg-studio-900 border-2 border-blue-400/40 rounded-2xl p-5 flex flex-col overflow-hidden">
            <div className="flex items-center justify-between border-b border-blue-400/25 pb-3 mb-4">
              <h3 className="font-display font-black text-lg text-white">
                ROSCOS INDIVIDUALES DE TODOS LOS CONCURSANTES ({publicState.contestants.length})
              </h3>
              <button
                type="button"
                onClick={() => setShowAllRoscosModal(false)}
                className="px-3 py-1 rounded-lg bg-slate-800 text-xs font-bold text-white"
              >
                Cerrar
              </button>
            </div>
            <div className="flex-1 overflow-y-auto grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {publicState.contestants.map((c) => (
                <div
                  key={c.id}
                  className="p-3.5 rounded-xl bg-studio-950 border border-blue-400/30 flex flex-col items-center gap-2"
                >
                  <div className="font-display font-bold text-sm text-white">
                    #{c.turnOrder} {c.name}
                  </div>
                  <MiniRosco2D
                    letters={c.letters}
                    activeLetter={c.currentLetter}
                    size={150}
                    isActivePlayer={c.id === publicState.activePlayerId}
                  />
                  <div className="text-xs flex items-center gap-3 font-bold">
                    <span className="text-amber-300">{c.score.totalPoints} pts</span>
                    <span className="text-emerald-400">✓{c.score.correctCount}</span>
                    <span className="text-red-400">✗{c.score.incorrectCount}</span>
                    <span className="text-blue-200">
                      ⏱{Math.ceil(c.timer.remainingMs / 1000)}s
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* MODAL: REGISTRO DE AUDITORÍA DE ACCIONES DEL PRESENTADOR */}
      {showAuditModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="w-full max-w-3xl max-h-[82vh] bg-studio-900 border-2 border-blue-400/40 rounded-2xl p-5 flex flex-col overflow-hidden">
            <div className="flex items-center justify-between border-b border-blue-400/25 pb-3 mb-3">
              <h3 className="font-display font-black text-base text-white">
                REGISTRO DE AUDITORÍA DE LA PARTIDA (GAME_EVENTS)
              </h3>
              <button
                type="button"
                onClick={() => setShowAuditModal(false)}
                className="px-3 py-1 rounded-lg bg-slate-800 text-xs font-bold text-white"
              >
                Cerrar
              </button>
            </div>
            <div className="flex-1 overflow-y-auto space-y-2 text-xs">
              {(presenterPrivate?.auditLog || []).map((evt) => (
                <div
                  key={evt.id}
                  className={`p-2.5 rounded-lg border flex items-center justify-between gap-2 ${
                    evt.undoneAt
                      ? 'bg-red-950/30 border-red-400/30 line-through text-slate-400'
                      : 'bg-studio-950 border-blue-400/20 text-slate-200'
                  }`}
                >
                  <div>
                    <span className="font-mono font-bold text-blue-300 mr-2">#{evt.seq}</span>
                    <span className="px-1.5 py-0.5 rounded bg-studio-800 text-[10px] font-bold text-amber-300 mr-2">
                      {evt.eventType}
                    </span>
                    <span>{evt.description}</span>
                  </div>
                  <span className="font-mono text-[10px] text-slate-400 shrink-0">
                    {new Date(evt.timestamp).toLocaleTimeString()}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* MODAL: CÓDIGO QR E INVITACIÓN */}
      {showQrModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="w-full max-w-lg bg-studio-900 border-2 border-blue-400/40 rounded-2xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-display font-black text-base text-white">
                INVITACIÓN A LA SALA PRL-ROSCO
              </h3>
              <button
                type="button"
                onClick={() => setShowQrModal(false)}
                className="px-3 py-1 rounded-lg bg-slate-800 text-xs font-bold text-white"
              >
                Cerrar
              </button>
            </div>
            <QrCodeInviteCard roomCode={publicState.roomCode} />
          </div>
        </div>
      )}

      {/* MODAL: BANCO DE PREGUNTAS PRL */}
      {showQuestionBankModal && (
        <QuestionBankAdminModal onClose={() => setShowQuestionBankModal(false)} />
      )}
    </div>
  );
};
