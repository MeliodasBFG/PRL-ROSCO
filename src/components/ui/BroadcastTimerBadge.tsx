import React from 'react';

interface BroadcastTimerBadgeProps {
  remainingMs: number;
  initialMs: number;
  correctCount: number;
  isRunning: boolean;
  playerName?: string;
}

/**
 * Cronómetro circular televisivo + marcador de aciertos inspirado directamente
 * en la esquina inferior izquierda de la imagen de referencia de concurso.
 */
export const BroadcastTimerBadge: React.FC<BroadcastTimerBadgeProps> = ({
  remainingMs,
  initialMs,
  correctCount,
  isRunning,
  playerName,
}) => {
  const seconds = Math.max(0, Math.ceil(remainingMs / 1000));
  const pct = Math.max(0, Math.min(1, remainingMs / Math.max(1000, initialMs)));
  const radius = 38;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference * (1 - pct);

  const isLowTime = seconds <= 15 && seconds > 0;

  return (
    <div
      data-testid="broadcast-timer-badge"
      className="flex items-center gap-2 sm:gap-3 select-none"
    >
      {/* Círculo grande naranja de cuenta atrás con anillo blanco */}
      <div className="relative w-20 h-20 sm:w-24 sm:h-24 flex items-center justify-center drop-shadow-[0_6px_20px_rgba(0,0,0,0.65)]">
        <svg className="w-full h-full -rotate-90" viewBox="0 0 92 92">
          {/* Anillo de fondo */}
          <circle
            cx="46"
            cy="46"
            r={radius}
            fill="url(#timerOrangeGrad)"
            stroke="rgba(255,255,255,0.22)"
            strokeWidth="7"
          />
          {/* Arco de progreso blanco/azul */}
          <circle
            cx="46"
            cy="46"
            r={radius}
            fill="transparent"
            stroke="#ffffff"
            strokeWidth="7"
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            strokeLinecap="round"
            className="transition-all duration-200"
          />
          <defs>
            <linearGradient id="timerOrangeGrad" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor={isLowTime ? '#ef4444' : '#fb923c'} />
              <stop offset="100%" stopColor={isLowTime ? '#b91c1c' : '#ea580c'} />
            </linearGradient>
          </defs>
        </svg>

        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span
            data-testid="active-timer-seconds"
            className={`font-display font-black text-2xl sm:text-3xl leading-none text-white drop-shadow ${
              isLowTime && isRunning ? 'animate-pulse' : ''
            }`}
          >
            {seconds}
          </span>
          <span className="text-[9px] font-bold uppercase tracking-wider text-orange-100 mt-0.5">
            {isRunning ? 'EN CURSO' : seconds === 0 ? 'AGOTADO' : 'PAUSA'}
          </span>
        </div>
      </div>

      {/* Círculo verde lateral de aciertos (idéntico al "22" verde junto al cronómetro en la referencia) */}
      <div className="flex flex-col items-start gap-1">
        <div
          data-testid="active-correct-counter"
          title="Número de aciertos en el rosco"
          className="w-13 h-13 sm:w-14 sm:h-14 rounded-full bg-gradient-to-b from-emerald-400 to-emerald-600 border-[3px] border-white shadow-rosco-green flex flex-col items-center justify-center px-3 py-2"
        >
          <span className="font-display font-black text-xl sm:text-2xl leading-none text-white drop-shadow">
            {correctCount}
          </span>
          <span className="text-[8px] font-bold uppercase tracking-tighter text-emerald-100">
            ACIERTOS
          </span>
        </div>
        {playerName && (
          <span className="px-2.5 py-0.5 rounded-full bg-studio-900/90 border border-blue-400/40 text-[11px] font-bold text-blue-100 truncate max-w-[130px]">
            {playerName}
          </span>
        )}
      </div>
    </div>
  );
};
