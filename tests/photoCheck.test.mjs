import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { AI_MIN, CROP, cropBox, NO_SIGNS_MAX, scanMetadata, sigmoid, toTensorData, verdictFor } from "../lib/photoCheck.ts";

const bytes = (s) => new TextEncoder().encode(s);

describe("scanMetadata", () => {
  it("finds the Stable Diffusion signature in a real PNG text chunk", () => {
    const m = scanMetadata(new Uint8Array(readFileSync("e2e/fixtures/sd-declared.png")));
    assert.deepEqual(m.ai, ["Stable Diffusion"]);
  });

  it("finds nothing declared in a plain camera-frame JPEG", () => {
    const m = scanMetadata(new Uint8Array(readFileSync("e2e/fixtures/real-person.jpg")));
    assert.deepEqual(m.ai, []);
    assert.equal(m.c2pa, false);
  });

  it("recognises the IPTC 'made by generative AI' label and named generators", () => {
    const xmp = '<Iptc4xmpExt:DigitalSourceType>http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia</Iptc4xmpExt:DigitalSourceType><xmp:CreatorTool>Midjourney</xmp:CreatorTool>';
    assert.deepEqual(scanMetadata(bytes(xmp)).ai.sort(), ["IPTC: made by generative AI", "Midjourney"]);
    assert.deepEqual(scanMetadata(bytes("Software: DALL·E 3")).ai, ["DALL·E"]);
    assert.deepEqual(scanMetadata(bytes("Adobe Firefly")).ai, ["Adobe Firefly"]);
  });

  it("detects a C2PA manifest only with its JUMBF container", () => {
    assert.equal(scanMetadata(bytes("jumb....c2pa.claim")).c2pa, true);
    assert.equal(scanMetadata(bytes("a blog post about c2pa")).c2pa, false);
  });

  it("reads the camera maker from EXIF text", () => {
    assert.equal(scanMetadata(bytes("Exif\0\0MM\0*Canon\0Canon EOS R5")).camera, "Canon");
    assert.equal(scanMetadata(bytes("no camera here")).camera, null);
  });
});

describe("model preprocessing", () => {
  it("centre-crops 384 px after scaling the short edge to 440", () => {
    const { sx, sy, side } = cropBox(1920, 1080);
    assert.ok(Math.abs(side - (384 * 1080) / 440) < 1e-9);
    assert.ok(Math.abs(sx - (1920 - side) / 2) < 1e-9 && Math.abs(sy - (1080 - side) / 2) < 1e-9);
  });

  it("CLIP-normalizes RGBA into channel-first floats", () => {
    const rgba = new Uint8ClampedArray(4 * 4).fill(255); // 2x2 white
    const t = toTensorData(rgba, 2);
    assert.equal(t.length, 12);
    assert.ok(Math.abs(t[0] - (1 - 0.48145466) / 0.26862954) < 1e-5); // R plane
    assert.ok(Math.abs(t[4] - (1 - 0.4578275) / 0.26130258) < 1e-5); // G plane starts at index 4
    assert.equal(CROP, 384);
  });

  it("sigmoid maps logits to probabilities", () => {
    assert.equal(sigmoid(0), 0.5);
    assert.ok(sigmoid(10) > 0.999 && sigmoid(-10) < 0.001);
  });
});

describe("verdictFor", () => {
  const none = { ai: [], c2pa: false, camera: null };

  it("trusts an AI declaration in the file over the model", () => {
    assert.equal(verdictFor({ ...none, ai: ["Midjourney"] }, 0.01), "DECLARED_AI");
  });

  it("maps model scores to bands and never claims a photo is real", () => {
    assert.equal(verdictFor(none, AI_MIN), "LIKELY_AI");
    assert.equal(verdictFor(none, NO_SIGNS_MAX), "NO_AI_SIGNS");
    assert.equal(verdictFor(none, 0.5), "UNCERTAIN");
  });

  it("is uncertain when the model could not run", () => {
    assert.equal(verdictFor(none, null), "UNCERTAIN");
  });
});
