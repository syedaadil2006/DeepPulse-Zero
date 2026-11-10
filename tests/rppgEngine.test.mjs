import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { compareFaceNeck, DEEPFAKE_HOLD_MS, meanRgb, MIN_SAMPLES, RppgEngine } from "../lib/rppgEngine.ts";
import { rng, skinRgb } from "./helpers.mjs";

const FRAME_MS = 1000 / 30;

/** Feed `frames` skin samples starting at frame `from`, evaluating every frame like the scanner does. */
function feed(engine, from, frames, sample) {
  let ev;
  for (let i = from; i < from + frames; i++) {
    engine.push(sample(i), i * FRAME_MS);
    ev = engine.evaluate(true, i * FRAME_MS);
  }
  return ev;
}

describe("meanRgb", () => {
  it("averages R, G and B over the ROI pixels only", () => {
    // 4x2 RGBA image: left half (x<2) is (10,20,30), right half is (200,200,200)
    const w = 4, h = 2;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) data.set(x < 2 ? [10, 20, 30, 255] : [200, 200, 200, 255], (y * w + x) * 4);
    assert.deepEqual(meanRgb(data, w, h, [{ label: "L", x: 0, y: 0, w: 2, h: 2 }]), [10, 20, 30]);
  });

  it("clips ROIs that hang off the frame and handles empty ROIs", () => {
    const data = new Uint8ClampedArray(4 * 4).fill(100);
    assert.deepEqual(meanRgb(data, 2, 2, [{ label: "X", x: -5, y: -5, w: 100, h: 100 }]), [100, 100, 100]);
    assert.deepEqual(meanRgb(data, 2, 2, []), [0, 0, 0]);
  });
});

describe("RppgEngine", () => {
  it("reports NO_FACE with no face, then CALIBRATING until it has enough samples", () => {
    const e = new RppgEngine();
    assert.equal(e.evaluate(false, 0).status, "NO_FACE");
    const rand = rng(1);
    const ev = feed(e, 0, MIN_SAMPLES - 1, (i) => skinRgb(i / 30, { rand }));
    assert.equal(ev.status, "CALIBRATING");
  });

  it("verifies a live pulse and measures its rate", () => {
    const rand = rng(2);
    const ev = feed(new RppgEngine(), 0, 256, (i) => skinRgb(i / 30, { hz: 1.2, rand }));
    assert.equal(ev.status, "VERIFIED_HUMAN");
    assert.ok(Math.abs(ev.bpm - 72) < 3, `bpm ${ev.bpm}`);
    assert.ok(ev.pulseIndex > 50);
    assert.ok(ev.beats.length >= 5, `beats ${ev.beats.length}`);
    assert.ok(ev.blood && ev.blood.angle < 10, `blood ${JSON.stringify(ev.blood)}`);
  });

  it("flags a feed that freezes while the face is still tracked (injection attack)", () => {
    const rand = rng(3);
    const e = new RppgEngine();
    feed(e, 0, 256, (i) => skinRgb(i / 30, { rand }));
    const frozen = skinRgb(256 / 30, { rand });
    // POS window (1.6 s) + flatness window (1 s) + hold (1.5 s) must elapse before the verdict flips
    const ev = feed(e, 256, 160, () => frozen);
    assert.equal(ev.status, "DEEPFAKE_DETECTED");
    assert.equal(ev.bpm, null);
    assert.equal(ev.pulseIndex, 0);
  });

  it("does not flag a frozen feed before the hold time has passed", () => {
    const rand = rng(4);
    const e = new RppgEngine();
    feed(e, 0, 256, (i) => skinRgb(i / 30, { rand }));
    const frozen = skinRgb(256 / 30, { rand });
    const framesBeforeHold = Math.floor((DEEPFAKE_HOLD_MS / FRAME_MS) * 0.5);
    assert.equal(feed(e, 256, framesBeforeHold, () => frozen).status, "VERIFIED_HUMAN");
  });

  it("starts over after reset", () => {
    const rand = rng(5);
    const e = new RppgEngine();
    feed(e, 0, 256, (i) => skinRgb(i / 30, { rand }));
    e.reset();
    assert.equal(e.length, 0);
    assert.equal(e.evaluate(true, 0).status, "CALIBRATING");
  });
});

describe("compareFaceNeck", () => {
  it("is in step when face and neck share one heartbeat", () => {
    const r1 = rng(6), r2 = rng(7);
    const face = new RppgEngine(), neck = new RppgEngine();
    for (let i = 0; i < 256; i++) {
      face.push(skinRgb(i / 30, { hz: 1.2, rand: r1 }), i * FRAME_MS);
      neck.push(skinRgb(i / 30, { hz: 1.2, amp: 0.003, rand: r2 }), i * FRAME_MS);
    }
    const c = compareFaceNeck(face, neck);
    assert.ok(c && c.agree && c.corr > 0.8, JSON.stringify(c));
  });

  it("is out of step when face and neck beat at different rates", () => {
    const r1 = rng(8), r2 = rng(9);
    const face = new RppgEngine(), neck = new RppgEngine();
    for (let i = 0; i < 256; i++) {
      face.push(skinRgb(i / 30, { hz: 1.6, rand: r1 }), i * FRAME_MS);
      neck.push(skinRgb(i / 30, { hz: 1.1, rand: r2 }), i * FRAME_MS);
    }
    const c = compareFaceNeck(face, neck);
    assert.ok(c && !c.agree && Math.abs(c.faceBpm - c.neckBpm) > 20, JSON.stringify(c));
  });

  it("returns null until both buffers are long enough", () => {
    const face = new RppgEngine(), neck = new RppgEngine();
    const rand = rng(10);
    for (let i = 0; i < 20; i++) face.push(skinRgb(i / 30, { rand }), i), neck.push(skinRgb(i / 30, { rand }), i);
    assert.equal(compareFaceNeck(face, neck), null);
  });
});
