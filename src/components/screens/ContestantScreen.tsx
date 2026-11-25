import React, { useMemo, useState } from 'react';
import {
  Trophy,
  Tv,
  Sparkles,
  CheckCircle2,
  BookOpen,
  ExternalLink,
  Clock,
  User,
} from 'lucide-react';
import { useRoscoStore } from '../../store/useRoscoStore';
import { TVStudioStage3D } from '../studio3d/TVStudioStage3D';
import { BroadcastTimerBadge } from '../ui/BroadcastTimerBadge';
import { MiniRosco2D } from '../ui/MiniRosco2D';
import { AudioControlsBar } from '../ui/AudioControlsBar';

/**
 * PANTALLA DE LOS CONCURSANTES (Sección 8)
 * - Espectacular escenario 3D con el concursante activo y su rosco de 27 letras.
 * - Tarjeta grande y legible con la pregunta actual.
 * - Panel personal ("Mi Panel Personal") con mi avatar, mi nombre, mi mini-rosco de 27 letras,
 *   mi puntuación, aciertos, errores, mi tiempo restante y mi estado.
 * - NUNCA muestra botones de ACIERTO, FALLO ni PASAPALABRA ni soluciones privadas.
 */
export const ContestantScreen: React.FC = () => {
  const {
    publicState,
    myPlayerId,
    displayRemainingMs,
    leaveRoom,
    force2DStage,
    setForce2DStage,
  } = useRoscoStore();

  const [showLeaderboardModal, setShowLeaderboardModal] = useState(false);

  const activeContestant = useMemo(() => {
    if (!publicState || !publicState.activePlayerId) return null;
    return (
      publicState.contestants.find((c) => c.id === publicState.activePlayerId) ?? null
    );
  }, [publicState]);

  const myContestant = useMemo(() => {
    if (!publicState || !myPlayerId) return null;
    return publicState.contestants.find((c) => c.id === myPlayerId) ?? null;
  }, [publicState, myPlayerId]);

  if (!publicState) return null;

  const isMyTurn = Boolean(myContestant && publicState.activePlayerId === myContestant.id);
  const activeLetter = publicState.activeLetter;
  const activeQuestion = publicState.activeQuestion;
  const myRemainingSeconds = myContestant
    ? Math.ceil(
        (isMyTurn ? displayRemainingMs : myContestant.timer.remainingMs) / 1000
      )
    : 0;

  return (
    <div
      data-testid="contestant-screen"
      className="min-h-screen bg-gradient-to-b from-studio-800 via-studio-950 to-black text-white flex flex-col"
    >
      {/* CABECERA DEL CONCURSANTE */}
      <header className="px-4 py-2.5 bg-studio-950/90 border-b border-blue-400/30 flex flex-wrap items-center justify-between gap-2 z-30">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-blue-600 border border-white/50 flex items-center justify-center shadow-rosco-blue">
            <Tv className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-display font-black text-base sm:text-lg text-white">
                PRL-ROSCO 3D
              </span>
              <span className="px-2 py-0.5 rounded-full bg-blue-500/20 border border-blue-400/40 font-mono text-xs font-bold text-blue-200">
                SALA {publicState.roomCode}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {(publicState.config.showLeaderboardDuringGame ||
            publicState.status === 'FINISHED') && (
            <button
              type="button"
              data-testid="btn-open-leaderboard"
              onClick={() => setShowLeaderboardModal(true)}
              className="px-3 py-1.5 rounded-xl bg-amber-500/20 hover:bg-amber-500/35 border border-amber-400/50 text-xs font-bold text-amber-200 flex items-center gap-1.5"
            >
              <Trophy className="w-4 h-4 text-amber-400" />
              Clasificación
            </button>
          )}
          <button
            type="button"
            onClick={() => setForce2DStage(!force2DStage)}
            className="px-2.5 py-1.5 rounded-lg bg-studio-800 border border-blue-400/30 text-xs text-slate-300"
          >
            {force2DStage ? '3D' : '2D'}
          </button>
          <AudioControlsBar />
          <button
            type="button"
            onClick={leaveRoom}
            className="px-2.5 py-1.5 rounded-lg bg-red-600/25 border border-red-400/40 text-xs font-bold text-red-200"
          >
            Salir
          </button>
        </div>
      </header>

      {/* ZONA PRINCIPAL: ESCENARIO 3D + PREGUNTA + MI PANEL PERSONAL */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-3 sm:p-5 grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* ZONA DE PLATÓ 3D Y TARJETA DE PREGUNTA (8 columnas) */}
        <div className="lg:col-span-8 flex flex-col gap-4">
          {/* Escenario 3D sincronizado en tiempo real */}
          <div className="relative rounded-3xl overflow-hidden border-2 border-blue-400/50 shadow-studio-glow h-[380px] sm:h-[470px]">
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

            {/* Indicador superior de quién tiene el turno en el centro del plató */}
            <div className="absolute top-3 left-3 right-3 flex flex-wrap items-center justify-between gap-2 pointer-events-none">
              <div
                className={`px-4 py-1.5 rounded-2xl border backdrop-blur-md flex items-center gap-2 shadow-lg ${
                  isMyTurn
                    ? 'bg-emerald-600/90 border-white text-white'
                    : 'bg-studio-950/90 border-blue-400/45 text-white'
                }`}
              >
                <Sparkles className="w-4 h-4 text-amber-300" />
                <span className="font-display font-black text-xs sm:text-sm">
                  {isMyTurn
                    ? '¡ESTÁS JUGANDO EN EL CENTRO DEL PLATÓ! RESPONDE EN VOZ ALTA'
                    : activeContestant
                    ? `JUGANDO AHORA: ${activeContestant.name.toUpperCase()}`
                    : 'ESPERANDO INICIO DE TURNO'}
                </span>
              </div>

              {activeContestant && (
                <div className="px-3.5 py-1.5 rounded-2xl bg-studio-950/90 border border-blue-400/40 backdrop-blur-md text-xs font-bold flex items-center gap-3">
                  <span className="text-amber-300">
                    {activeContestant.score.totalPoints} pts
                  </span>
                  <span className="text-emerald-400">
                    ✓ {activeContestant.score.correctCount}
                  </span>
                  <span className="text-red-400">
                    ✗ {activeContestant.score.incorrectCount}
                  </span>
                </div>
              )}
            </div>

            {/* Esquina inferior izquierda: Cronómetro grande del concursante activo */}
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

            {/* Esquina inferior derecha: Letra activa */}
            {activeLetter && (
              <div className="absolute bottom-3 right-3">
                <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-gradient-to-b from-blue-400 to-blue-700 border-4 border-white shadow-rosco-blue flex flex-col items-center justify-center">
                  <span className="text-[9px] font-bold uppercase text-blue-100">LETRA</span>
                  <span className="font-display font-black text-2xl sm:text-3xl leading-none text-white">
                    {activeLetter}
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* TARJETA GRANDE Y LEGIBLE DE LA PREGUNTA ACTUAL */}
          <div className="p-5 rounded-3xl bg-studio-900/95 border-2 border-blue-400/45 shadow-2xl space-y-3">
            {activeQuestion ? (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="px-3.5 py-1 rounded-xl bg-blue-600 font-display font-black text-xs sm:text-sm text-white shadow-rosco-blue">
                      {activeQuestion.mode === 'EMPIEZA_POR'
                        ? `EMPIEZA POR LA ${activeQuestion.letter}`
                        : `CONTIENE LA ${activeQuestion.letter}`}
                    </span>
                    <span className="px-3 py-1 rounded-xl bg-studio-800 border border-blue-400/30 text-xs font-semibold text-blue-200">
                      {activeQuestion.category}
                    </span>
                  </div>

                  {publicState.lastEvent && (
                    <span className="text-xs font-semibold text-blue-300">
                      {publicState.lastEvent.description}
                    </span>
                  )}
                </div>

                <p
                  data-testid="contestant-question-statement"
                  className="text-lg sm:text-2xl font-extrabold text-white leading-snug"
                >
                  {activeQuestion.statement}
                </p>

                {/* Solo se muestra si el presentador ha pulsado deliberadamente "Revelar respuesta" o "Mostrar explicación" */}
                {activeQuestion.revealedAnswer && (
                  <div
                    data-testid="contestant-revealed-answer"
                    className="p-3 rounded-xl bg-emerald-950/80 border border-emerald-400 text-sm text-emerald-100 flex items-center gap-2"
                  >
                    <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
                    <div>
                      <span className="font-bold text-emerald-300">Respuesta correcta: </span>
                      <strong className="text-white text-base">
                        {activeQuestion.revealedAnswer}
                      </strong>
                    </div>
                  </div>
                )}

                {activeQuestion.revealedExplanation && (
                  <div
                    data-testid="contestant-revealed-explanation"
                    className="p-3 rounded-xl bg-amber-950/60 border border-amber-400/50 text-xs sm:text-sm text-amber-100 space-y-1"
                  >
                    <div className="font-bold text-amber-300 flex items-center gap-1.5">
                      <BookOpen className="w-4 h-4" />
                      Explicación de Prevención de Riesgos Laborales:
                    </div>
                    <p>{activeQuestion.revealedExplanation}</p>
                    {activeQuestion.revealedSource && (
                      <div className="text-[11px] text-amber-200 flex items-center gap-2 pt-1">
                        <span>Fuente: {activeQuestion.revealedSource}</span>
                        {activeQuestion.revealedSourceUrl && (
                          <a
                            href={activeQuestion.revealedSourceUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="underline inline-flex items-center gap-0.5"
                          >
                            Ver BOE/INSST <ExternalLink className="w-3 h-3" />
                          </a>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </>
            ) : (
              <div className="py-5 text-center text-base font-bold text-blue-200">
                {publicState.status === 'FINISHED'
                  ? '¡El concurso ha finalizado! Revisa el podio 3D y la clasificación final.'
                  : 'Atento al presentador para la siguiente pregunta del Rosco PRL.'}
              </div>
            )}
          </div>
        </div>

        {/* MI PANEL PERSONAL (4 columnas — Visible en todo momento aunque juegue otro concursante) */}
        <div className="lg:col-span-4 space-y-4">
          {myContestant && (
            <div
              data-testid="my-personal-panel"
              className="p-5 rounded-3xl bg-studio-900/95 border-2 border-blue-400/45 shadow-2xl space-y-4"
            >
              <div className="flex items-center justify-between border-b border-blue-400/20 pb-3">
                <div className="flex items-center gap-3">
                  <div
                    className="w-11 h-11 rounded-full border-2 border-white shadow flex items-center justify-center"
                    style={{ backgroundColor: myContestant.avatar.outfitColor }}
                  >
                    <div
                      className="w-5 h-5 rounded-full"
                      style={{ backgroundColor: myContestant.avatar.skinColor }}
                    />
                  </div>
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-wider text-blue-300 flex items-center gap-1">
                      <User className="w-3 h-3" />
                      MI PANEL PERSONAL
                    </div>
                    <div
                      data-testid="my-panel-name"
                      className="font-display font-black text-base text-white"
                    >
                      {myContestant.name} (Turno #{myContestant.turnOrder})
                    </div>
                  </div>
                </div>

                <span
                  data-testid="my-panel-status"
                  className={`px-2.5 py-1 rounded-full text-[11px] font-extrabold uppercase ${
                    isMyTurn
                      ? 'bg-emerald-500 text-studio-950 animate-pulse'
                      : myContestant.status === 'FINISHED'
                      ? 'bg-amber-500/25 text-amber-300 border border-amber-400/40'
                      : 'bg-blue-500/25 text-blue-200 border border-blue-400/40'
                  }`}
                >
                  {isMyTurn
                    ? 'JUGANDO'
                    : myContestant.status === 'FINISHED'
                    ? 'TERMINADO'
                    : myContestant.status === 'PAUSED'
                    ? 'EN ESPERA'
                    : 'ESPERANDO'}
                </span>
              </div>

              {/* Mi Mini Rosco de 27 letras */}
              <div className="flex flex-col items-center justify-center py-1">
                <MiniRosco2D
                  letters={myContestant.letters}
                  activeLetter={myContestant.currentLetter}
                  size={188}
                  isActivePlayer={isMyTurn}
                />
              </div>

              {/* Mis Estadísticas y Mi Tiempo Restante */}
              <div className="grid grid-cols-2 gap-2.5">
                <div className="p-3 rounded-2xl bg-studio-950/85 border border-blue-400/25 text-center">
                  <div className="text-[10px] font-bold uppercase text-blue-300">
                    MI TIEMPO RESTANTE
                  </div>
                  <div
                    data-testid="my-personal-timer"
                    className="font-mono font-black text-2xl text-amber-300 flex items-center justify-center gap-1 mt-0.5"
                  >
                    <Clock className="w-4 h-4" />
                    {myRemainingSeconds}s
                  </div>
                </div>

                <div className="p-3 rounded-2xl bg-studio-950/85 border border-blue-400/25 text-center">
                  <div className="text-[10px] font-bold uppercase text-blue-300">
                    MI PUNTUACIÓN
                  </div>
                  <div
                    data-testid="my-personal-score"
                    className="font-display font-black text-2xl text-white mt-0.5"
                  >
                    {myContestant.score.totalPoints} <span className="text-xs text-blue-300">pts</span>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="p-2.5 rounded-xl bg-emerald-950/60 border border-emerald-400/35">
                  <div className="font-display font-black text-lg text-emerald-400">
                    {myContestant.score.correctCount}
                  </div>
                  <div className="text-[10px] font-bold uppercase text-emerald-200">Aciertos</div>
                </div>
                <div className="p-2.5 rounded-xl bg-red-950/60 border border-red-400/35">
                  <div className="font-display font-black text-lg text-red-400">
                    {myContestant.score.incorrectCount}
                  </div>
                  <div className="text-[10px] font-bold uppercase text-red-200">Errores</div>
                </div>
                <div className="p-2.5 rounded-xl bg-amber-950/60 border border-amber-400/35">
                  <div className="font-display font-black text-lg text-amber-300">
                    {myContestant.score.pendingCount}
                  </div>
                  <div className="text-[10px] font-bold uppercase text-amber-200">Pendientes</div>
                </div>
              </div>
            </div>
          )}

          {/* CLASIFICACIÓN EN VIVO (SI EL PRESENTADOR LA TIENE HABILITADA) */}
          {(publicState.config.showLeaderboardDuringGame ||
            publicState.status === 'FINISHED') && (
            <div className="p-4 rounded-3xl bg-studio-900/90 border border-blue-400/35 shadow-xl space-y-2.5">
              <div className="flex items-center justify-between border-b border-blue-400/20 pb-2">
                <span className="font-display font-black text-xs uppercase text-amber-300 flex items-center gap-1.5">
                  <Trophy className="w-4 h-4" />
                  CLASIFICACIÓN DE LA COMPETICIÓN
                </span>
                <span className="text-[10px] text-blue-200">
                  Desempate: Aciertos · Errores · Tiempo
                </span>
              </div>

              <div className="space-y-1.5 max-h-[210px] overflow-y-auto pr-1">
                {publicState.leaderboard.map((score) => {
                  const player = publicState.contestants.find(
                    (c) => c.id === score.playerId
                  );
                  if (!player) return null;
                  const isMe = player.id === myPlayerId;

                  return (
                    <div
                      key={score.playerId}
                      className={`px-3 py-2 rounded-xl border flex items-center justify-between text-xs ${
                        isMe
                          ? 'bg-blue-600/35 border-blue-300 font-bold'
                          : 'bg-studio-950/75 border-blue-400/20'
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className={`w-6 h-6 rounded-full font-display font-black flex items-center justify-center text-[11px] ${
                            score.rankPosition === 1
                              ? 'bg-amber-400 text-studio-950'
                              : score.rankPosition === 2
                              ? 'bg-slate-300 text-studio-950'
                              : score.rankPosition === 3
                              ? 'bg-amber-700 text-white'
                              : 'bg-studio-800 text-blue-200'
                          }`}
                        >
                          {score.rankPosition}º
                        </span>
                        <span className="truncate text-white">{player.name}</span>
                      </div>

                      <div className="flex items-center gap-2.5 shrink-0">
                        <span className="text-emerald-400">✓{score.correctCount}</span>
                        <span className="text-red-400">✗{score.incorrectCount}</span>
                        <span className="font-mono font-black text-amber-300">
                          {score.totalPoints} pts
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </main>

      {/* MODAL DE CLASIFICACIÓN COMPLETA */}
      {showLeaderboardModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="w-full max-w-2xl bg-studio-900 border-2 border-amber-400/50 rounded-3xl p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-blue-400/25 pb-3">
              <h3 className="font-display font-black text-lg text-amber-300 flex items-center gap-2">
                <Trophy className="w-5 h-5" />
                CLASIFICACIÓN GENERAL PRL-ROSCO
              </h3>
              <button
                type="button"
                onClick={() => setShowLeaderboardModal(false)}
                className="px-3 py-1 rounded-lg bg-slate-800 text-xs font-bold text-white"
              >
                Cerrar
              </button>
            </div>

            <div className="space-y-2 max-h-[60vh] overflow-y-auto">
              {publicState.leaderboard.map((score) => {
                const player = publicState.contestants.find((c) => c.id === score.playerId);
                if (!player) return null;
                return (
                  <div
                    key={score.playerId}
                    className="p-3 rounded-xl bg-studio-950 border border-blue-400/30 flex items-center justify-between"
                  >
                    <div className="flex items-center gap-3">
                      <span className="w-8 h-8 rounded-full bg-blue-600 font-display font-black text-sm flex items-center justify-center">
                        {score.rankPosition}º
                      </span>
                      <div>
                        <div className="font-bold text-sm text-white">{player.name}</div>
                        <div className="text-[11px] text-blue-300">
                          Tiempo empleado: {Math.round(score.timeConsumedMs / 1000)}s · Precisión:{' '}
                          {score.accuracyPct}%
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-4 text-sm font-bold">
                      <span className="text-emerald-400">{score.correctCount} aciertos</span>
                      <span className="text-red-400">{score.incorrectCount} fallos</span>
                      <span className="px-3 py-1 rounded-lg bg-amber-500 text-studio-950 font-black">
                        {score.totalPoints} PTS
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
