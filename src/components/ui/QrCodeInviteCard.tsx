import React, { useMemo, useState } from 'react';
import { Copy, Check, QrCode, Share2 } from 'lucide-react';

interface QrCodeInviteCardProps {
  roomCode: string;
  compact?: boolean;
}

/**
 * Genera una matriz determinista visual estilo código QR en SVG para el enlace de invitación
 * sin llamadas a servicios externos de rastreo.
 */
export const QrCodeInviteCard: React.FC<QrCodeInviteCardProps> = ({ roomCode, compact = false }) => {
  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);

  const inviteUrl = useMemo(() => {
    if (typeof window === 'undefined') return `https://prl-rosco.pages.dev/?room=${roomCode}`;
    const base = `${window.location.origin}${window.location.pathname}`;
    return `${base}?room=${encodeURIComponent(roomCode)}`;
  }, [roomCode]);

  const matrix = useMemo(() => {
    const size = 21;
    const grid: boolean[][] = Array.from({ length: size }, () => Array(size).fill(false));

    // Patrones de búsqueda (esquinas QR)
    const drawFinder = (r0: number, c0: number) => {
      for (let r = 0; r < 7; r++) {
        for (let c = 0; c < 7; c++) {
          const isBorder = r === 0 || r === 6 || c === 0 || c === 6;
          const isCenter = r >= 2 && r <= 4 && c >= 2 && c <= 4;
          grid[r0 + r][c0 + c] = isBorder || isCenter;
        }
      }
    };
    drawFinder(0, 0);
    drawFinder(0, size - 7);
    drawFinder(size - 7, 0);

    // Semilla basada en roomCode e inviteUrl
    let hash = 2166136261;
    const str = `${roomCode}:${inviteUrl}`;
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        const inFinder =
          (r < 8 && c < 8) || (r < 8 && c >= size - 8) || (r >= size - 8 && c < 8);
        if (inFinder) continue;
        const ch = str.charCodeAt((r * size + c) % str.length);
        hash ^= ch + r * 31 + c * 17;
        hash = Math.imul(hash, 16777619);
        grid[r][c] = (Math.abs(hash) & 1) === 1;
      }
    }
    return grid;
  }, [roomCode, inviteUrl]);

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(roomCode);
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 1800);
    } catch {
      // Ignorar
    }
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopiedUrl(true);
      setTimeout(() => setCopiedUrl(false), 1800);
    } catch {
      // Ignorar
    }
  };

  return (
    <div className="p-4 rounded-2xl bg-studio-900/90 border border-blue-400/35 shadow-xl flex flex-col sm:flex-row items-center gap-4">
      {/* Matriz QR SVG */}
      <div className="p-2.5 bg-white rounded-xl shadow-md shrink-0">
        <svg
          width={compact ? 96 : 124}
          height={compact ? 96 : 124}
          viewBox="0 0 21 21"
          shapeRendering="crispEdges"
          aria-label={`Código QR de la sala ${roomCode}`}
        >
          {matrix.map((row, rIdx) =>
            row.map((cell, cIdx) =>
              cell ? (
                <rect key={`${rIdx}-${cIdx}`} x={cIdx} y={rIdx} width={1} height={1} fill="#041442" />
              ) : null
            )
          )}
        </svg>
      </div>

      {/* Código y botones de compartir */}
      <div className="flex-1 text-center sm:text-left space-y-2">
        <div className="flex items-center justify-center sm:justify-start gap-1.5 text-xs font-bold uppercase tracking-wider text-blue-300">
          <QrCode className="w-3.5 h-3.5" />
          Código de Sala PRL-ROSCO
        </div>

        <div className="flex items-center justify-center sm:justify-start gap-2">
          <span
            data-testid="room-code-display"
            className="px-3.5 py-1.5 rounded-xl bg-blue-600/30 border-2 border-blue-400 font-mono font-black text-2xl sm:text-3xl tracking-widest text-white shadow-rosco-blue"
          >
            {roomCode}
          </span>
          <button
            type="button"
            onClick={copyCode}
            className="p-2.5 rounded-xl bg-studio-800 hover:bg-studio-700 border border-blue-400/30 text-blue-100 transition"
            title="Copiar código de sala"
          >
            {copiedCode ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
          </button>
        </div>

        <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2 pt-1">
          <button
            type="button"
            onClick={copyLink}
            className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-xs font-bold text-white flex items-center gap-1.5 shadow transition"
          >
            {copiedUrl ? (
              <>
                <Check className="w-3.5 h-3.5" />
                ¡Enlace copiado!
              </>
            ) : (
              <>
                <Share2 className="w-3.5 h-3.5" />
                Compartir enlace de invitación
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
