import React from 'react';
import {
  LetterState,
  PlayerLetterProgress,
  ROSCO_LETTERS,
  RoscoLetter,
} from '../../../shared/types';

interface MiniRosco2DProps {
  letters: Record<RoscoLetter, PlayerLetterProgress>;
  activeLetter?: RoscoLetter | null;
  size?: number;
  isActivePlayer?: boolean;
}

/**
 * Mini Rosco circular de 27 letras para la tarjeta personal de cada concursante
 * y la vista multipantalla del presentador.
 */
export const MiniRosco2D: React.FC<MiniRosco2DProps> = ({
  letters,
  activeLetter,
  size = 156,
  isActivePlayer = false,
}) => {
  const total = ROSCO_LETTERS.length; // 27 letras exactas
  const radiusPct = 42.5;
  const dotSize = size < 130 ? 13 : 16;

  return (
    <div
      data-testid="mini-rosco-27"
      style={{ width: size, height: size }}
      className="relative flex items-center justify-center select-none shrink-0"
    >
      {/* Círculo guía interior */}
      <div className="w-[82%] h-[82%] rounded-full border border-blue-400/25 bg-studio-900/50 flex items-center justify-center">
        <div className="text-center">
          <div className="text-[10px] uppercase tracking-wider text-blue-300 font-semibold">
            {isActivePlayer ? 'EN PLATÓ' : 'MI ROSCO'}
          </div>
          <div className="text-sm font-display font-black text-white">27 LETRAS</div>
        </div>
      </div>

      {ROSCO_LETTERS.map((letter, idx) => {
        const angle = Math.PI / 2 - (idx * 2 * Math.PI) / total;
        const left = 50 + Math.cos(angle) * radiusPct;
        const top = 50 - Math.sin(angle) * radiusPct;
        const st: LetterState = letters?.[letter]?.state ?? 'UNSEEN';
        const isCurrent = isActivePlayer && (activeLetter === letter || st === 'ACTIVE');

        let colorClass = 'bg-slate-700/90 text-slate-200 border-slate-400/40';
        if (isCurrent || st === 'ACTIVE') {
          colorClass = 'bg-blue-500 text-white border-white scale-125 shadow-rosco-blue z-10';
        } else if (st === 'CORRECT') {
          colorClass = 'bg-emerald-500 text-white border-emerald-200';
        } else if (st === 'INCORRECT') {
          colorClass = 'bg-red-600 text-white border-red-200';
        } else if (st === 'PASSED') {
          colorClass = 'bg-amber-500 text-white border-amber-200';
        }

        return (
          <div
            key={letter}
            title={`Letra ${letter}: ${st}`}
            style={{
              left: `${left}%`,
              top: `${top}%`,
              width: dotSize,
              height: dotSize,
              fontSize: dotSize < 15 ? 8 : 9,
            }}
            className={`-translate-x-1/2 -translate-y-1/2 absolute rounded-full border flex items-center justify-center font-display font-extrabold transition-all ${colorClass}`}
          >
            {letter}
          </div>
        );
      })}
    </div>
  );
};
