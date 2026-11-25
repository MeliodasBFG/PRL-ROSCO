import React from 'react';

interface BroadcastTimerBadgeProps {
  remainingMs: number;
  initialMs: number;
  correctCount: number;
  isRunning: boolean;
  playerName?: string;
  compact?: boolean;
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
  compact = false,
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
      <div
        className={`relative flex items-center justify-center drop-shadow-[0_6px_20px_rgba(0,0,0,0.65)] ${
          compact ? 'w-14 h-14 sm:w-16 sm:h-16' : 'w-16 h-16 sm:w-20 sm:h-20'
        }`}
      >
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
            className={`font-display font-black leading-none text-white drop-shadow ${
              compact ? 'text-lg sm:text-xl' : 'text-xl sm:text-2xl'
            } ${isLowTime && isRunning ? 'animate-pulse' : ''}`}
          >
            {seconds}
          </span>
          <span className="text-[8px] font-bold uppercase tracking-wider text-orange-100 mt-0.5">
            {isRunning ? 'EN CURSO' : seconds === 0 ? 'AGOTADO' : 'PAUSA'}
          </span>
        </div>
      </div>

      {/* Círculo verde lateral de aciertos (idéntico al "22" verde junto al cronómetro en la referencia) */}
      <div className="flex flex-col items-start gap-1">
        <div
          data-testid="active-correct-counter"
          title="Número de aciertos en el rosco"
          className={`rounded-full bg-gradient-to-b from-emerald-400 to-emerald-600 border-[3px] border-white shadow-rosco-green flex flex-col items-center justify-center ${
            compact ? 'px-2.5 py-1 min-w-[44px]' : 'px-3 py-1.5 min-w-[52px]'
          }`}
        >
          <span
            className={`font-display font-black leading-none text-white drop-shadow ${
              compact ? 'text-base sm:text-lg' : 'text-lg sm:text-xl'
            }`}
          >
            {correctCount}
          </span>
          <span className="text-[7px] font-bold uppercase tracking-tighter text-emerald-100">
            ACIERTOS
          </span>
        </div>
        {playerName && !compact && (
          <span className="px-2.5 py-0.5 rounded-full bg-studio-900/90 border border-blue-400/40 text-[11px] font-bold text-blue-100 truncate max-w-[130px]">
            {playerName}
          </span>
        )}
      </div>
    </div>
  );
};
