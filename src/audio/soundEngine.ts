// ============================================================================
// PRL-ROSCO — MOTOR DE IDENTIDAD SONORA ORIGINAL (WEB AUDIO API)
// 12 efectos especiales de concurso + 4 pistas de música ambiental procedural
// Sin recursos protegidos de terceros; controles independientes de volumen
// ============================================================================

export type SoundEffectType =
  | 'ROOM_START'
  | 'CONTESTANT_INTRO'
  | 'LETTER_ACTIVATE'
  | 'CORRECT'
  | 'INCORRECT'
  | 'PASAPALABRA'
  | 'TIMER_START'
  | 'TIMER_WARNING'
  | 'TIMER_EXPIRED'
  | 'TURN_CHANGE'
  | 'ROSCO_COMPLETE'
  | 'VICTORY';

export type MusicTrackType = 'NONE' | 'LOBBY' | 'QUIZ' | 'TENSION' | 'FINALE';

export interface AudioPreferences {
  musicVolume: number; // 0..1
  sfxVolume: number;   // 0..1
  musicMuted: boolean;
  sfxMuted: boolean;
}

const STORAGE_KEY = 'prl_rosco_audio_prefs_v1';

class RoscoSoundEngine {
  private ctx: AudioContext | null = null;
  private unlocked = false;
  private prefs: AudioPreferences = {
    musicVolume: 0.35,
    sfxVolume: 0.75,
    musicMuted: false,
    sfxMuted: false,
  };
  private currentTrack: MusicTrackType = 'NONE';
  private musicIntervalId: number | null = null;
  private musicStep = 0;

  constructor() {
    this.loadPreferences();
  }

  private loadPreferences(): void {
    if (typeof window === 'undefined') return;
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        this.prefs = { ...this.prefs, ...parsed };
      }
    } catch {
      // Usar valores por defecto
    }
  }

  private savePreferences(): void {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(this.prefs));
    } catch {
      // Ignorar errores de almacenamiento
    }
  }

  public getPreferences(): AudioPreferences {
    return { ...this.prefs };
  }

  public setMusicVolume(volume: number): void {
    this.prefs.musicVolume = Math.max(0, Math.min(1, volume));
    this.savePreferences();
  }

  public setSfxVolume(volume: number): void {
    this.prefs.sfxVolume = Math.max(0, Math.min(1, volume));
    this.savePreferences();
  }

  public toggleMusicMute(): boolean {
    this.prefs.musicMuted = !this.prefs.musicMuted;
    this.savePreferences();
    return this.prefs.musicMuted;
  }

  public toggleSfxMute(): boolean {
    this.prefs.sfxMuted = !this.prefs.sfxMuted;
    this.savePreferences();
    return this.prefs.sfxMuted;
  }

  public unlock(): void {
    if (typeof window === 'undefined') return;
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      if (!this.ctx) {
        this.ctx = new AudioCtx();
      }
      if (this.ctx.state === 'suspended') {
        this.ctx.resume();
      }
      this.unlocked = true;
    } catch {
      // En entornos de test sin Web Audio API no falla
    }
  }

  private playTone(
    freq: number,
    durationSec: number,
    delaySec = 0,
    type: OscillatorType = 'sine',
    gainMultiplier = 0.25,
    isMusic = false
  ): void {
    if (!this.unlocked || !this.ctx) return;
    if (isMusic && (this.prefs.musicMuted || this.prefs.musicVolume <= 0.01)) return;
    if (!isMusic && (this.prefs.sfxMuted || this.prefs.sfxVolume <= 0.01)) return;

    try {
      const now = this.ctx.currentTime + delaySec;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = type;
      osc.frequency.setValueAtTime(freq, now);

      const baseVol = isMusic ? this.prefs.musicVolume : this.prefs.sfxVolume;
      const peakGain = Math.max(0.001, baseVol * gainMultiplier);

      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(peakGain, now + 0.018);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + durationSec);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(now);
      osc.stop(now + durationSec + 0.02);
    } catch {
      // Ignorar si el contexto no está disponible
    }
  }

  public playSfx(effect: SoundEffectType): void {
    this.unlock();
    if (!this.unlocked || this.prefs.sfxMuted) return;

    switch (effect) {
      case 'ROOM_START':
        // Acorde ascendente de apertura de plató
        this.playTone(261.63, 0.22, 0, 'triangle', 0.28);
        this.playTone(329.63, 0.22, 0.09, 'triangle', 0.28);
        this.playTone(392.0, 0.25, 0.18, 'triangle', 0.3);
        this.playTone(523.25, 0.45, 0.27, 'sine', 0.35);
        break;

      case 'CONTESTANT_INTRO':
        // Cortinilla televisiva de entrada de concursante
        this.playTone(392.0, 0.14, 0, 'triangle', 0.26);
        this.playTone(440.0, 0.14, 0.11, 'triangle', 0.26);
        this.playTone(587.33, 0.36, 0.22, 'sine', 0.32);
        break;

      case 'LETTER_ACTIVATE':
        // Destello suave de activación de esfera del rosco
        this.playTone(587.33, 0.12, 0, 'sine', 0.2);
        this.playTone(880.0, 0.16, 0.05, 'sine', 0.18);
        break;

      case 'CORRECT':
        // Campanilla brillante de ACIERTO (arpegio mayor luminoso)
        this.playTone(523.25, 0.12, 0, 'triangle', 0.34);
        this.playTone(659.25, 0.14, 0.08, 'triangle', 0.36);
        this.playTone(783.99, 0.16, 0.16, 'triangle', 0.38);
        this.playTone(1046.5, 0.38, 0.24, 'sine', 0.42);
        break;

      case 'INCORRECT':
        // Efecto grave de FALLO
        this.playTone(185.0, 0.24, 0, 'sawtooth', 0.3);
        this.playTone(138.59, 0.44, 0.18, 'sawtooth', 0.34);
        break;

      case 'PASAPALABRA':
        // Efecto de transición de Pasapalabra (doble tono suspendido)
        this.playTone(440.0, 0.14, 0, 'sine', 0.26);
        this.playTone(659.25, 0.22, 0.1, 'triangle', 0.28);
        break;

      case 'TIMER_START':
        this.playTone(660.0, 0.1, 0, 'sine', 0.2);
        break;

      case 'TIMER_WARNING':
        // Pulso de aviso cuando quedan pocos segundos
        this.playTone(880.0, 0.07, 0, 'square', 0.16);
        break;

      case 'TIMER_EXPIRED':
        // Bocina / Gong de tiempo agotado
        this.playTone(220.0, 0.25, 0, 'sawtooth', 0.34);
        this.playTone(196.0, 0.25, 0.2, 'sawtooth', 0.34);
        this.playTone(146.83, 0.6, 0.4, 'sawtooth', 0.38);
        break;

      case 'TURN_CHANGE':
        // Ráfaga de cesión de turno a otro concursante
        this.playTone(329.63, 0.12, 0, 'triangle', 0.25);
        this.playTone(493.88, 0.14, 0.1, 'triangle', 0.26);
        this.playTone(659.25, 0.28, 0.2, 'sine', 0.3);
        break;

      case 'ROSCO_COMPLETE':
        this.playTone(440.0, 0.15, 0, 'triangle', 0.3);
        this.playTone(554.37, 0.15, 0.12, 'triangle', 0.3);
        this.playTone(659.25, 0.15, 0.24, 'triangle', 0.32);
        this.playTone(880.0, 0.45, 0.36, 'sine', 0.38);
        break;

      case 'VICTORY':
        // Fanfarria triunfal del podio 3D
        this.playTone(523.25, 0.16, 0, 'triangle', 0.36);
        this.playTone(523.25, 0.14, 0.18, 'triangle', 0.36);
        this.playTone(659.25, 0.22, 0.32, 'triangle', 0.38);
        this.playTone(783.99, 0.26, 0.52, 'triangle', 0.4);
        this.playTone(1046.5, 0.65, 0.76, 'sine', 0.45);
        break;
    }
  }

  public setMusicTrack(track: MusicTrackType): void {
    if (this.currentTrack === track) return;
    this.currentTrack = track;
    if (this.musicIntervalId !== null && typeof window !== 'undefined') {
      window.clearInterval(this.musicIntervalId);
      this.musicIntervalId = null;
    }
    if (track === 'NONE' || typeof window === 'undefined') return;

    this.musicStep = 0;
    const intervalMs =
      track === 'TENSION' ? 420 : track === 'QUIZ' ? 680 : track === 'FINALE' ? 520 : 1100;

    this.musicIntervalId = window.setInterval(() => {
      if (!this.unlocked || this.prefs.musicMuted) return;
      this.musicStep = (this.musicStep + 1) % 8;

      if (this.currentTrack === 'LOBBY') {
        const notes = [261.63, 329.63, 392.0, 493.88, 392.0, 329.63, 293.66, 349.23];
        this.playTone(notes[this.musicStep], 0.75, 0, 'sine', 0.08, true);
      } else if (this.currentTrack === 'QUIZ') {
        const notes = [196.0, 246.94, 293.66, 392.0, 293.66, 246.94, 220.0, 261.63];
        this.playTone(notes[this.musicStep], 0.35, 0, 'triangle', 0.07, true);
      } else if (this.currentTrack === 'TENSION') {
        const notes = [220.0, 233.08, 220.0, 196.0, 220.0, 233.08, 261.63, 246.94];
        this.playTone(notes[this.musicStep], 0.22, 0, 'triangle', 0.1, true);
      } else if (this.currentTrack === 'FINALE') {
        const notes = [523.25, 659.25, 783.99, 1046.5, 783.99, 659.25, 587.33, 783.99];
        this.playTone(notes[this.musicStep], 0.35, 0, 'sine', 0.1, true);
      }
    }, intervalMs);
  }
}

export const soundEngine = new RoscoSoundEngine();
