import type { LivenessStatus, Roi } from "@/types";
import { analyzeCardiac, bloodColour, cardiacBandpass, correlation, FFT_SIZE, pos, type BloodColour, type Rgb } from "./fft.ts";
import { detectBeats } from "./breathChallenge.ts";

// shortcut: thresholds hand-tuned for indoor webcam light; calibrate on real attack/bona-fide footage before production
export const PULSE_FRACTION_MIN = 0.5; // white noise: median 0.32, p95 0.49 (tests/signal.test.mjs)
export const SYNTHETIC_FRACTION_MAX = 0.2; // below the 5th percentile of white noise
export const RECENT_STD_MIN = 1e-4; // POS units over the last second; a frozen/injected feed is exactly 0
export const DEEPFAKE_HOLD_MS = 1500;
export const MIN_SAMPLES = 90; // ~3 s at 30 FPS before any verdict
// Face-neck sync is display-only: on 27 test clips real people ranged -0.11..0.50 and fakes -0.55..0.70 (no separation).
export const NECK_SYNC_MIN = 0.3;
// shortcut: tuned end-to-end in the app on 37 clips (EVALUATION.md); leave-one-out: 57% of fakes caught, 1 of 16 real
// people flagged. Small pilot set; re-tune on a larger held-out set (FaceForensics++, Celeb-DF) before relying on it.
export const BLOOD_ANGLE_MAX = 22;
export const VIDEO_AI_MIN = 0.45; // mean image-model score over 8 sampled frames

/** Upload verdict: pulse colour unlike blood, or frames that look generated. */
export const videoSuspicious = (bloodAngle: number | null, imageAi: number | null) =>
  (bloodAngle !== null && bloodAngle > BLOOD_ANGLE_MAX) || (imageAi !== null && imageAi >= VIDEO_AI_MIN);

/** Mean [R, G, B] over all pixels inside the ROI rectangles (RGBA buffer). */
export function meanRgb(data: Uint8ClampedArray, width: number, height: number, rois: Roi[]): Rgb {
  const sum: Rgb = [0, 0, 0];
  let count = 0;
  for (const r of rois) {
    const x0 = Math.max(0, Math.floor(r.x));
    const y0 = Math.max(0, Math.floor(r.y));
    const x1 = Math.min(width, Math.ceil(r.x + r.w));
    const y1 = Math.min(height, Math.ceil(r.y + r.h));
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const i = (y * width + x) * 4;
        sum[0] += data[i];
        sum[1] += data[i + 1];
        sum[2] += data[i + 2];
        count++;
      }
    }
  }
  return count ? (sum.map((v) => v / count) as Rgb) : [0, 0, 0];
}

export interface Evaluation {
  status: LivenessStatus;
  bpm: number | null;
  pulseIndex: number;
  snrDb: number;
  bufferFill: number;
  waveform: number[];
  beats: number[];
  blood: BloodColour | null;
}

export class RppgEngine {
  private rgb: Rgb[] = [];
  private g: number[] = []; // POS pulse signal, recomputed on evaluate
  private t: number[] = [];
  private lowSince: number | null = null;

  push(rgb: Rgb, timeMs: number) {
    this.rgb.push(rgb);
    this.t.push(timeMs);
    if (this.rgb.length > FFT_SIZE) {
      this.rgb.shift();
      this.t.shift();
    }
  }

  get length() {
    return this.rgb.length;
  }

  /** POS pulse signal over the current window. */
  signal(): number[] {
    return pos(this.rgb, this.fs);
  }

  reset() {
    this.rgb = [];
    this.g = [];
    this.t = [];
    this.lowSince = null;
  }

  get fs(): number {
    const n = this.t.length;
    if (n < 2) return 30;
    return (n - 1) / ((this.t[n - 1] - this.t[0]) / 1000);
  }

  private recentStd(): number {
    const w = this.g.slice(-Math.max(2, Math.round(this.fs)));
    const m = w.reduce((a, b) => a + b, 0) / w.length;
    return Math.sqrt(w.reduce((a, b) => a + (b - m) ** 2, 0) / w.length);
  }

  evaluate(facePresent: boolean, now: number): Evaluation {
    this.g = this.signal();
    const bufferFill = this.g.length / FFT_SIZE;
    if (!facePresent) {
      this.lowSince = null;
      return { status: "NO_FACE", bpm: null, pulseIndex: 0, snrDb: 0, bufferFill, waveform: [], beats: [], blood: null };
    }
    if (this.g.length < MIN_SAMPLES) {
      return { status: "CALIBRATING", bpm: null, pulseIndex: 0, snrDb: 0, bufferFill, waveform: [], beats: [], blood: null };
    }

    const fs = this.fs;
    const spec = analyzeCardiac(this.g, fs);
    const flat = this.recentStd() < RECENT_STD_MIN;
    const pulseOk = !flat && spec.peakFraction >= PULSE_FRACTION_MIN;
    // real webcam rPPG is often weak/noisy, so only a dead-flat feed or a sub-noise spectrum counts as synthetic
    const synthetic = flat || spec.peakFraction < SYNTHETIC_FRACTION_MAX;

    if (!synthetic) this.lowSince = null;
    else if (this.lowSince === null) this.lowSince = now;
    const status: LivenessStatus =
      this.lowSince !== null && now - this.lowSince > DEEPFAKE_HOLD_MS ? "DEEPFAKE_DETECTED" : "VERIFIED_HUMAN";

    // map peak fraction (≈0.3 for white noise, →1 for a pure tone) to 0-100
    const pulseIndex = flat ? 0 : Math.round(Math.max(0, Math.min(1, (spec.peakFraction - 0.3) / 0.6)) * 100);

    const waveform = flat ? [] : cardiacBandpass(this.g, fs);
    return {
      status,
      bpm: pulseOk ? spec.bpm : null,
      pulseIndex,
      snrDb: Number.isFinite(spec.snrDb) ? spec.snrDb : 0,
      bufferFill,
      waveform,
      // skip edge beats: the filter is unreliable at the window ends
      blood: spec.bpm ? bloodColour(this.rgb, fs, spec.bpm / 60) : null,
      beats: detectBeats(waveform, this.t.slice(-waveform.length)).filter((b) => b > this.t[0] + 300 && b < this.t[this.t.length - 1] - 300),
    };
  }
}

export interface NeckCheck {
  faceBpm: number;
  neckBpm: number;
  /** correlation of the two bandpassed pulse waves, -1..1 */
  corr: number;
  agree: boolean;
}

/** One body, one heart: the face pulse should match the pulse in the neck skin below it. */
export function compareFaceNeck(face: RppgEngine, neck: RppgEngine): NeckCheck | null {
  const n = Math.min(face.length, neck.length);
  if (n < MIN_SAMPLES) return null;
  const fs = face.fs;
  const a = face.signal().slice(-n);
  const b = neck.signal().slice(-n);
  const fa = analyzeCardiac(a, fs);
  const fb = analyzeCardiac(b, fs);
  if (fa.bpm === null || fb.bpm === null) return null;
  const corr = correlation(cardiacBandpass(a, fs), cardiacBandpass(b, fs));
  // BPM peaks disagree even on real people (8% match in testing); waveform correlation is the usable signal
  return { faceBpm: fa.bpm, neckBpm: fb.bpm, corr, agree: corr >= NECK_SYNC_MIN };
}
