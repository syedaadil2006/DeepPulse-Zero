/**
 * Breath Challenge: a live, randomized challenge-response on an involuntary reflex.
 * Inhaling briefly speeds the heart, exhaling slows it (respiratory sinus arrhythmia).
 * A replayed or source-driven pulse cannot follow cues it has never seen.
 */

export interface Phase {
  kind: "in" | "out";
  start: number; // ms, same clock as the beat times
  end: number;
}

export interface HrPoint {
  t: number;
  hr: number;
  cue: 1 | -1 | 0;
}

export interface ChallengeResult {
  verdict: "PASS" | "FAIL" | "INCONCLUSIVE";
  /** mean HR while inhaling minus mean HR while exhaling, in BPM */
  diff: number;
  /** permutation-test p-value: chance a heart ignoring the cues scores this well */
  p: number;
  points: HrPoint[];
}

export const RSA_LAG_MS = 1000; // heart rate trails the breath by about a second
const MIN_PER_PHASE = 6;

/** Randomized cue schedule so a pre-recorded pulse can't line up with it by chance. */
export function makePhases(start: number, cycles = 4, rand = Math.random): Phase[] {
  const phases: Phase[] = [];
  let t = start;
  for (let i = 0; i < cycles * 2; i++) {
    const dur = 4000 + rand() * 2500;
    phases.push({ kind: i % 2 === 0 ? "in" : "out", start: t, end: t + dur });
    t += dur;
  }
  return phases;
}

/** Peak times (ms) of a bandpassed pulse wave sampled at `times`. */
export function detectBeats(wave: number[], times: number[], minGapMs = 333): number[] {
  const beats: number[] = [];
  let lastV = -Infinity;
  for (let i = 1; i < wave.length - 1; i++) {
    const v = wave[i];
    if (v < 0.15 || v <= wave[i - 1] || v < wave[i + 1]) continue;
    const t = times[i];
    if (beats.length && t - beats[beats.length - 1] < minGapMs) {
      if (v > lastV) {
        beats[beats.length - 1] = t;
        lastV = v;
      }
      continue;
    }
    beats.push(t);
    lastV = v;
  }
  return beats;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[s.length >> 1];
}

export function scoreChallenge(beatTimes: number[], phases: Phase[], rand = Math.random, lagMs = RSA_LAG_MS): ChallengeResult {
  const b = [...beatTimes].sort((x, y) => x - y);
  let pts: { t: number; hr: number }[] = [];
  for (let i = 1; i < b.length; i++) {
    const ibi = b[i] - b[i - 1];
    if (ibi >= 333 && ibi <= 1500) pts.push({ t: (b[i] + b[i - 1]) / 2, hr: 60000 / ibi });
  }
  // missed or doubled beats make 30%+ jumps; drop them
  if (pts.length) {
    const m = median(pts.map((p) => p.hr));
    pts = pts.filter((p) => Math.abs(p.hr - m) / m < 0.3);
  }

  const t0 = phases[0].start;
  const span = phases[phases.length - 1].end - t0;
  const cueAt = (x: number): 1 | -1 | 0 => {
    const ph = phases.find((p) => x >= p.start && x < p.end);
    return ph ? (ph.kind === "in" ? 1 : -1) : 0;
  };
  const diffFor = (shift: number) => {
    let si = 0, ni = 0, so = 0, no = 0;
    for (const p of pts) {
      const rel = p.t - lagMs - t0;
      if (rel < 0 || rel >= span) continue;
      const c = cueAt(t0 + ((rel + shift) % span));
      if (c === 1) (si += p.hr), ni++;
      else if (c === -1) (so += p.hr), no++;
    }
    return { d: ni && no ? si / ni - so / no : 0, ni, no };
  };

  const real = diffFor(0);
  const points: HrPoint[] = pts.map((p) => ({ ...p, cue: cueAt(p.t - lagMs) }));
  if (real.ni < MIN_PER_PHASE || real.no < MIN_PER_PHASE) return { verdict: "INCONCLUSIVE", diff: real.d, p: 1, points };

  // circular-shift null: same heartbeats, cues slid to random offsets
  const N = 300;
  let ge = 0;
  for (let i = 0; i < N; i++) if (diffFor(span * (0.1 + 0.8 * rand())).d >= real.d) ge++;
  const p = (ge + 1) / (N + 1);
  return { verdict: real.d >= 1.5 && p < 0.1 ? "PASS" : "FAIL", diff: real.d, p, points };
}
