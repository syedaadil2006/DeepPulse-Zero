import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { analyzeCardiac, bloodColour, cardiacBandpass, correlation, fft, pos } from "../lib/fft.ts";
import { BLOOD, rng, skinRgb } from "./helpers.mjs";

const FS = 30;

describe("fft", () => {
  it("matches a naive DFT", () => {
    const rand = rng(1);
    const x = Array.from({ length: 16 }, () => rand());
    const re = Float64Array.from(x);
    const im = new Float64Array(16);
    fft(re, im);
    for (let k = 0; k < 16; k++) {
      let r = 0, i = 0;
      for (let n = 0; n < 16; n++) {
        r += x[n] * Math.cos((-2 * Math.PI * k * n) / 16);
        i += x[n] * Math.sin((-2 * Math.PI * k * n) / 16);
      }
      assert.ok(Math.abs(re[k] - r) < 1e-9 && Math.abs(im[k] - i) < 1e-9, `bin ${k}`);
    }
  });

  it("rejects lengths that are not a power of two", () => {
    assert.throws(() => fft(new Float64Array(12), new Float64Array(12)));
  });
});

describe("analyzeCardiac", () => {
  const rand = rng(42);
  const pulse = Array.from({ length: 256 }, (_, i) => 120 + 0.4 * Math.sin(2 * Math.PI * 1.2 * (i / FS)) + 0.3 * rand() + i * 0.01);

  it("finds a 72 BPM pulse through noise and drift", () => {
    const r = analyzeCardiac(pulse, FS);
    assert.ok(Math.abs(r.bpm - 72) < 2, `bpm ${r.bpm}`);
    assert.ok(r.peakFraction > 0.6);
  });

  it("does not mistake white noise for a pulse", () => {
    const noise = Array.from({ length: 256 }, () => 120 + rand());
    assert.ok(analyzeCardiac(noise, FS).peakFraction < 0.5);
  });

  it("returns no BPM for a flat signal", () => {
    assert.equal(analyzeCardiac(Array(256).fill(120), FS).bpm, null);
  });

  it("bandpass keeps the window length and stays in [-1, 1]", () => {
    const wave = cardiacBandpass(pulse, FS);
    assert.equal(wave.length, 256);
    assert.ok(wave.every((v) => Math.abs(v) <= 1 + 1e-9));
  });
});

describe("POS pulse extraction", () => {
  it("recovers a 75 BPM pulse under lighting drift", () => {
    const rand = rng(3);
    const rgb = Array.from({ length: 256 }, (_, i) => skinRgb(i / FS, { hz: 1.25, rand }));
    const r = analyzeCardiac(pos(rgb, FS), FS);
    assert.ok(Math.abs(r.bpm - 75) < 2, `bpm ${r.bpm}`);
  });

  it("gives an exactly flat signal for a frozen frame", () => {
    assert.ok(pos(Array(256).fill([150, 100, 90]), FS).every((v) => v === 0));
  });
});

describe("correlation", () => {
  it("is 1 for proportional signals, -1 for inverted, 0 for flat", () => {
    assert.ok(Math.abs(correlation([1, 2, 3, 4], [2, 4, 6, 8]) - 1) < 1e-9);
    assert.ok(Math.abs(correlation([1, 2, 3, 4], [4, 3, 2, 1]) + 1) < 1e-9);
    assert.equal(correlation([1, 2, 3], [5, 5, 5]), 0);
  });
});

describe("bloodColour (Blood Colour Fingerprint)", () => {
  const make = (ratio) => {
    const rand = rng(9);
    return Array.from({ length: 256 }, (_, i) => skinRgb(i / FS, { ratio, noise: 0.03, rand }));
  };

  it("matches haemoglobin's direction for a blood-coloured pulse", () => {
    const b = bloodColour(make(BLOOD), FS, 1.2);
    assert.ok(b.angle < 3 && b.inPhase, JSON.stringify(b));
  });

  it("is far off for a brightness-only flicker", () => {
    assert.ok(bloodColour(make([1, 1, 1]), FS, 1.2).angle > 15);
  });

  it("catches a channel moving out of phase", () => {
    assert.equal(bloodColour(make([-0.33, 0.77, 0.53]), FS, 1.2).inPhase, false);
  });

  it("returns null without enough samples or a heart frequency", () => {
    assert.equal(bloodColour(make(BLOOD).slice(0, 10), FS, 1.2), null);
    assert.equal(bloodColour(make(BLOOD), FS, 0), null);
  });
});

import { videoSuspicious } from "../lib/rppgEngine.ts";
it("upload verdict fuses blood colour and image model", () => {
  assert.equal(videoSuspicious(null, null), false);
  assert.equal(videoSuspicious(20, 0.05), false);
  assert.equal(videoSuspicious(23, 0.05), true); // wrong blood colour alone
  assert.equal(videoSuspicious(22, 0.44), false); // both just under their cut-offs
  assert.equal(videoSuspicious(12, 0.5), true); // generated-looking frames alone (e.g. the face-swap)
});
