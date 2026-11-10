export const CARDIAC_MIN_HZ = 0.7;
export const CARDIAC_MAX_HZ = 3.0;
export const FFT_SIZE = 256;

/** In-place iterative radix-2 Cooley-Tukey FFT. Length must be a power of 2. */
export function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  if (n & (n - 1)) throw new Error("FFT size must be a power of 2");
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    const halfLen = len >> 1;
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < halfLen; k++) {
        const a = i + k;
        const b = a + halfLen;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

function detrend(x: number[]): number[] {
  const n = x.length;
  const mean = x.reduce((a, b) => a + b, 0) / n;
  const tm = (n - 1) / 2;
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i++) {
    sxy += (i - tm) * (x[i] - mean);
    sxx += (i - tm) ** 2;
  }
  const slope = sxx ? sxy / sxx : 0;
  return x.map((v, i) => v - mean - slope * (i - tm));
}

function bandBins(fs: number): [number, number] {
  const res = fs / FFT_SIZE;
  return [Math.max(1, Math.ceil(CARDIAC_MIN_HZ / res)), Math.min(FFT_SIZE / 2 - 1, Math.floor(CARDIAC_MAX_HZ / res))];
}

/** Ideal FFT bandpass (0.7-3.0 Hz) of the trailing window, returned normalized to [-1, 1]. */
export function cardiacBandpass(samples: number[], fs: number): number[] {
  const x = detrend(samples.slice(-FFT_SIZE));
  const n = x.length;
  const re = new Float64Array(FFT_SIZE);
  const im = new Float64Array(FFT_SIZE);
  x.forEach((v, i) => (re[i] = v));
  fft(re, im);
  const [lo, hi] = bandBins(fs);
  for (let k = 0; k < FFT_SIZE; k++) {
    const inBand = (k >= lo && k <= hi) || (k >= FFT_SIZE - hi && k <= FFT_SIZE - lo);
    if (!inBand) re[k] = im[k] = 0;
    else im[k] = -im[k]; // conjugate for inverse
  }
  fft(re, im);
  const out = Array.from(re.subarray(0, n), (v) => v / FFT_SIZE);
  const peak = out.reduce((m, v) => Math.max(m, Math.abs(v)), 0) || 1;
  return out.map((v) => v / peak);
}

export interface CardiacSpectrum {
  bpm: number | null;
  /** fraction of in-band power within ±1 bin of the dominant peak (0-1) */
  peakFraction: number;
  snrDb: number;
}

/** Hann-windowed spectrum of the trailing ≤256 samples, peak-picked in the cardiac band. */
export function analyzeCardiac(samples: number[], fs: number): CardiacSpectrum {
  const x = detrend(samples.slice(-FFT_SIZE));
  const n = x.length;
  const re = new Float64Array(FFT_SIZE);
  const im = new Float64Array(FFT_SIZE);
  for (let i = 0; i < n; i++) re[i] = x[i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / Math.max(1, n - 1)));
  fft(re, im);

  const [lo, hi] = bandBins(fs);
  const p = (k: number) => re[k] * re[k] + im[k] * im[k];
  let total = 0;
  let peakK = lo;
  for (let k = lo; k <= hi; k++) {
    total += p(k);
    if (p(k) > p(peakK)) peakK = k;
  }
  if (total <= 1e-12) return { bpm: null, peakFraction: 0, snrDb: -Infinity };

  let sig = 0;
  for (let k = Math.max(lo, peakK - 1); k <= Math.min(hi, peakK + 1); k++) sig += p(k);
  const noise = Math.max(total - sig, 1e-12);

  // parabolic interpolation on log power for sub-bin BPM
  const a = Math.log(p(peakK - 1) + 1e-12);
  const b = Math.log(p(peakK) + 1e-12);
  const c = Math.log(p(peakK + 1) + 1e-12);
  const denom = a - 2 * b + c;
  const delta = denom ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / denom)) : 0;

  return {
    bpm: 60 * (peakK + delta) * (fs / FFT_SIZE),
    peakFraction: sig / total,
    snrDb: 10 * Math.log10(sig / noise),
  };
}

export type Rgb = [number, number, number];

/**
 * POS rPPG (Wang et al., IEEE TBME 2017): temporally normalize RGB, project onto the plane
 * orthogonal to skin tone, combine the two projections with an adaptive weight, overlap-add.
 * Far more robust to lighting and motion than the green channel alone.
 */
export function pos(rgb: Rgb[], fs: number): number[] {
  const n = rgb.length;
  const l = Math.max(2, Math.round(1.6 * fs));
  const H = new Array<number>(n).fill(0);
  for (let m = 0; m + l <= n; m++) {
    const mean = [0, 0, 0];
    for (let i = m; i < m + l; i++) for (let c = 0; c < 3; c++) mean[c] += rgb[i][c] / l;
    if (!mean[0] || !mean[1] || !mean[2]) continue;
    const s1: number[] = [];
    const s2: number[] = [];
    for (let i = m; i < m + l; i++) {
      const r = rgb[i][0] / mean[0];
      const g = rgb[i][1] / mean[1];
      const b = rgb[i][2] / mean[2];
      s1.push(g - b);
      s2.push(g + b - 2 * r);
    }
    const sd = (x: number[]) => {
      const mu = x.reduce((a, v) => a + v, 0) / x.length;
      return Math.sqrt(x.reduce((a, v) => a + (v - mu) ** 2, 0) / x.length);
    };
    const sd2 = sd(s2);
    const alpha = sd2 > 1e-12 ? sd(s1) / sd2 : 0;
    const h = s1.map((v, i) => v + alpha * s2[i]);
    const mu = h.reduce((a, v) => a + v, 0) / l;
    for (let i = 0; i < l; i++) H[m + i] += h[i] - mu;
  }
  return H;
}

/** Pearson correlation of two equal-length signals (0 if either is flat). */
export function correlation(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 2) return 0;
  const x = a.slice(-n);
  const y = b.slice(-n);
  const mx = x.reduce((s, v) => s + v, 0) / n;
  const my = y.reduce((s, v) => s + v, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (x[i] - mx) * (y[i] - my);
    sxx += (x[i] - mx) ** 2;
    syy += (y[i] - my) ** 2;
  }
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : 0;
}

/** Haemoglobin's pulse colour direction in normalized RGB (de Haan & van Leest, Physiol. Meas. 2014; Wang et al., TBME 2019). */
export const PBV_SIGNATURE: Rgb = [0.33, 0.77, 0.53];

export interface BloodColour {
  /** relative pulse amplitude per channel at the heart frequency, unit length */
  vec: Rgb;
  /** angle in degrees between the measured colour direction and haemoglobin's */
  angle: number;
  /** red and blue pulse in phase with green, as absorption by blood requires */
  inPhase: boolean;
}

/**
 * Blood Colour Fingerprint: the colour direction of the pulse at the heart frequency.
 * Real blood shifts skin colour along a fixed haemoglobin direction (green >> blue > red, all in phase).
 */
export function bloodColour(rgb: Rgb[], fs: number, hz: number): BloodColour | null {
  const n = rgb.length;
  if (n < 32 || !(hz > 0)) return null;
  const X = [0, 1, 2].map((c) => {
    const ch = rgb.map((p) => p[c]);
    const mean = ch.reduce((a, v) => a + v, 0) / n;
    if (!mean) return [0, 0];
    const x = detrend(ch.map((v) => v / mean));
    let re = 0, im = 0;
    for (let i = 0; i < n; i++) {
      const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
      const a = (2 * Math.PI * hz * i) / fs;
      re += x[i] * w * Math.cos(a);
      im -= x[i] * w * Math.sin(a);
    }
    return [re, im];
  });
  const mag = X.map(([re, im]) => Math.hypot(re, im));
  const len = Math.hypot(...mag);
  if (!len) return null;
  const vec = mag.map((m) => m / len) as Rgb;
  const pl = Math.hypot(...PBV_SIGNATURE);
  const cos = vec.reduce((a, v, i) => a + v * (PBV_SIGNATURE[i] / pl), 0);
  // in phase with green: positive real part of X_c * conj(X_g)
  const dot = (c: number) => X[c][0] * X[1][0] + X[c][1] * X[1][1];
  return { vec, angle: (Math.acos(Math.min(1, cos)) * 180) / Math.PI, inPhase: dot(0) > 0 && dot(2) > 0 };
}
