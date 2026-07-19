/**
 * Tiny synthesized sound effects via the Web Audio API — no audio assets needed.
 * The AudioContext is created lazily on the first user gesture (browser autoplay policy).
 */

const MUTE_KEY = 'gloworm-muted';

let ctx: AudioContext | null = null;
let muted = false;

try {
  muted = localStorage.getItem(MUTE_KEY) === '1';
} catch {
  // Storage unavailable — default to sound on.
}

export function initAudio() {
  if (ctx) {
    if (ctx.state === 'suspended') void ctx.resume();
    return;
  }
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (Ctor) ctx = new Ctor();
}

export function isMuted() {
  return muted;
}

export function setMuted(value: boolean) {
  muted = value;
  try {
    localStorage.setItem(MUTE_KEY, value ? '1' : '0');
  } catch {
    // Best effort.
  }
}

function tone(
  frequency: number,
  duration: number,
  options: { type?: OscillatorType; volume?: number; slideTo?: number; delay?: number } = {},
) {
  if (!ctx || muted || ctx.state !== 'running') return;
  const { type = 'sine', volume = 0.08, slideTo, delay = 0 } = options;

  const start = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = type;
  osc.frequency.setValueAtTime(frequency, start);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, start + duration);

  gain.gain.setValueAtTime(volume, start);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);

  osc.connect(gain).connect(ctx.destination);
  osc.start(start);
  osc.stop(start + duration + 0.05);
}

let lastOrbSound = 0;
let orbPitchStep = 0;

/** Short ascending blip; consecutive pickups climb in pitch for a combo feel. */
export function playOrbPickup() {
  const now = performance.now();
  if (now - lastOrbSound < 60) return;
  orbPitchStep = now - lastOrbSound < 700 ? Math.min(orbPitchStep + 1, 12) : 0;
  lastOrbSound = now;
  tone(520 * Math.pow(1.06, orbPitchStep), 0.12, { type: 'triangle', volume: 0.06, slideTo: 700 * Math.pow(1.06, orbPitchStep) });
}

export function playDeath() {
  tone(320, 0.5, { type: 'sawtooth', volume: 0.1, slideTo: 60 });
  tone(180, 0.6, { type: 'square', volume: 0.05, slideTo: 40, delay: 0.05 });
}

export function playJoin() {
  tone(300, 0.15, { type: 'triangle', volume: 0.07, slideTo: 520 });
  tone(520, 0.2, { type: 'triangle', volume: 0.07, slideTo: 780, delay: 0.12 });
}
