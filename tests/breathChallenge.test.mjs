import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { detectBeats, makePhases, scoreChallenge } from "../lib/breathChallenge.ts";

/** Seeded random in [0, 1). */
const seeded = (seed) => {
  let s = seed;
  return () => (s = (s * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32;
};

describe("makePhases", () => {
  it("alternates in/out with 4-6.5 s random durations and no gaps", () => {
    const phases = makePhases(1000, 4, seeded(1));
    assert.equal(phases.length, 8);
    phases.forEach((p, i) => {
      assert.equal(p.kind, i % 2 === 0 ? "in" : "out");
      const dur = p.end - p.start;
      assert.ok(dur >= 4000 && dur <= 6500, `duration ${dur}`);
      if (i) assert.equal(p.start, phases[i - 1].end);
    });
    assert.equal(phases[0].start, 1000);
  });

  it("is different every run (unpredictable to a replay)", () => {
    assert.notDeepEqual(makePhases(0), makePhases(0));
  });
});

describe("detectBeats", () => {
  const times = Array.from({ length: 150 }, (_, i) => i * 33.3);

  it("finds one beat per cycle of a 1.2 Hz wave", () => {
    const wave = times.map((t) => Math.sin((2 * Math.PI * 1.2 * t) / 1000));
    assert.equal(detectBeats(wave, times).length, 6);
  });

  it("ignores small ripples below the threshold", () => {
    assert.equal(detectBeats(times.map((t) => 0.1 * Math.sin(t / 50)), times).length, 0);
  });

  it("never returns two beats closer than 333 ms (180 BPM)", () => {
    const wave = times.map((t) => Math.sin((2 * Math.PI * 4 * t) / 1000)); // 240 BPM
    const beats = detectBeats(wave, times);
    beats.slice(1).forEach((b, i) => assert.ok(b - beats[i] >= 333));
  });
});

describe("scoreChallenge", () => {
  const rand = seeded(7);
  const phases = makePhases(0, 4, rand);
  const end = phases.at(-1).end + 2000;
  const cueAt = (x) => {
    const p = phases.find((q) => x >= q.start && x < q.end);
    return p ? (p.kind === "in" ? 1 : -1) : 0;
  };
  /** Beat times for a heart whose rate rises `rsa` BPM on in-breaths (1 s lag), with jitter. */
  const beatsFor = (rsa) => {
    const out = [];
    for (let t = -1000; t < end; ) {
      out.push(t);
      t += 60000 / (72 + rsa * cueAt(t - 1000) + (rand() - 0.5) * 8);
    }
    return out;
  };

  it("passes a heart that follows the breathing cues", () => {
    const r = scoreChallenge(beatsFor(5), phases, rand);
    assert.equal(r.verdict, "PASS", JSON.stringify({ d: r.diff, p: r.p }));
    assert.ok(r.diff > 1.5 && r.p < 0.1);
  });

  it("does not pass a replayed heart that ignores the cues", () => {
    assert.notEqual(scoreChallenge(beatsFor(0), phases, rand).verdict, "PASS");
  });

  it("does not pass a heart that moves the wrong way", () => {
    assert.notEqual(scoreChallenge(beatsFor(-5), phases, rand).verdict, "PASS");
  });

  it("is inconclusive with too few beats", () => {
    assert.equal(scoreChallenge([0, 800, 1600], phases, rand).verdict, "INCONCLUSIVE");
  });

  it("drops doubled beats instead of reading them as a heart-rate spike", () => {
    const beats = beatsFor(5);
    const doubled = [...beats, ...beats.filter((_, i) => i % 9 === 0).map((b) => b + 150)];
    assert.ok(scoreChallenge(doubled, phases, rand).points.every((p) => p.hr < 110));
  });
});
