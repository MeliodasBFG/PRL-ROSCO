import React, { useState } from 'react';
import { Volume2, VolumeX, Music, Sparkles } from 'lucide-react';
import { soundEngine } from '../../audio/soundEngine';

export const AudioControlsBar: React.FC = () => {
  const [prefs, setPrefs] = useState(() => soundEngine.getPreferences());
  const [open, setOpen] = useState(false);

  const handleToggleMusic = () => {
    soundEngine.unlock();
    soundEngine.toggleMusicMute();
    setPrefs(soundEngine.getPreferences());
  };

  const handleToggleSfx = () => {
    soundEngine.unlock();
    soundEngine.toggleSfxMute();
    setPrefs(soundEngine.getPreferences());
  };

  const handleMusicVol = (e: React.ChangeEvent<HTMLInputElement>) => {
    soundEngine.unlock();
    soundEngine.setMusicVolume(parseFloat(e.target.value));
    setPrefs(soundEngine.getPreferences());
  };

  const handleSfxVol = (e: React.ChangeEvent<HTMLInputElement>) => {
    soundEngine.unlock();
    soundEngine.setSfxVolume(parseFloat(e.target.value));
    soundEngine.playSfx('LETTER_ACTIVATE');
    setPrefs(soundEngine.getPreferences());
  };

  return (
    <div className="relative">
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={handleToggleSfx}
          title={prefs.sfxMuted ? 'Activar efectos de sonido' : 'Silenciar efectos de sonido'}
          className={`p-2 rounded-lg border text-xs font-semibold flex items-center gap-1 transition ${
            prefs.sfxMuted
              ? 'bg-slate-800/80 border-slate-600 text-slate-400'
              : 'bg-blue-600/30 border-blue-400/50 text-blue-100 hover:bg-blue-600/50'
          }`}
        >
          {prefs.sfxMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
          <span className="hidden md:inline">Efectos</span>
        </button>

        <button
          type="button"
          onClick={handleToggleMusic}
          title={prefs.musicMuted ? 'Activar música de plató' : 'Silenciar música de plató'}
          className={`p-2 rounded-lg border text-xs font-semibold flex items-center gap-1 transition ${
            prefs.musicMuted
              ? 'bg-slate-800/80 border-slate-600 text-slate-400'
              : 'bg-indigo-600/30 border-indigo-400/50 text-indigo-100 hover:bg-indigo-600/50'
          }`}
        >
          <Music className="w-4 h-4" />
          <span className="hidden md:inline">Música</span>
        </button>

        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="px-2.5 py-2 rounded-lg bg-studio-800/80 border border-blue-400/30 text-xs font-semibold text-blue-200 hover:bg-studio-700"
        >
          Mezclador
        </button>
      </div>

      {open && (
        <div className="absolute right-0 mt-2 w-64 p-4 rounded-xl bg-studio-900/95 border border-blue-400/40 shadow-2xl backdrop-blur-md z-50 space-y-3">
          <div className="flex items-center justify-between border-b border-blue-400/20 pb-2">
            <span className="text-xs font-bold uppercase tracking-wider text-blue-200 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-amber-400" />
              Audio de Concurso
            </span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-xs text-slate-400 hover:text-white"
            >
              Cerrar
            </button>
          </div>

          <div className="space-y-1">
            <div className="flex justify-between text-xs">
              <span className="text-slate-200 font-medium">Efectos Especiales</span>
              <span className="text-blue-300 font-mono">
                {prefs.sfxMuted ? 'MUTE' : `${Math.round(prefs.sfxVolume * 100)}%`}
              </span>
            </div>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={prefs.sfxVolume}
              onChange={handleSfxVol}
              className="w-full accent-blue-500 cursor-pointer"
            />
          </div>

          <div className="space-y-1">
            <div className="flex justify-between text-xs">
              <span className="text-slate-200 font-medium">Música de Plató</span>
              <span className="text-indigo-300 font-mono">
                {prefs.musicMuted ? 'MUTE' : `${Math.round(prefs.musicVolume * 100)}%`}
              </span>
            </div>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={prefs.musicVolume}
              onChange={handleMusicVol}
              className="w-full accent-indigo-500 cursor-pointer"
            />
          </div>
        </div>
      )}
    </div>
  );
};
