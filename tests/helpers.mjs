// Shared, deterministic test signals.

/** Seeded random in [-0.5, 0.5) so every run sees the same "noise". */
export function rng(seed = 42) {
  let s = seed;
  return () => ((s = (s * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32) - 0.5;
}

/** Haemoglobin's pulse colour direction (de Haan & van Leest 2014). */
export const BLOOD = [0.33, 0.77, 0.53];

/**
 * One RGB skin sample at time t (s): skin-coloured light, slow lighting drift,
 * a pulse at `hz` whose per-channel strength follows `ratio`, plus sensor noise.
 */
export function skinRgb(t, { hz = 1.2, amp = 0.004, ratio = BLOOD, noise = 0.05, rand }) {
  const drift = 1 + 0.01 * Math.sin(2 * Math.PI * 0.3 * t);
  const p = amp * Math.sin(2 * Math.PI * hz * t);
  return [170, 120, 100].map((base, c) => base * drift * (1 + ratio[c] * p) + rand() * noise);
}
