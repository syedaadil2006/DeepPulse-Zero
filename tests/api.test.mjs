import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { appendFileSync, mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as socket from "../app/api/socket/route.ts";
import * as certRoute from "../app/api/certificate/route.ts";
import { check, issue, parseClaims, signingKeys } from "../lib/certificate.ts";

process.env.DPZ_DATA_DIR = mkdtempSync(join(tmpdir(), "dpz-test-")); // keep the key and alert log out of the project

const post = (url, body) =>
  new Request(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body) });

const alert = { id: "a1", sessionId: "CAND-TEST", source: "live", status: "DEEPFAKE_DETECTED", bpm: null, pulseIndex: 0, timestamp: 1 };
const telemetry = {
  kind: "telemetry",
  sessionId: "CAND-TEST",
  source: "meeting",
  status: "VERIFIED_HUMAN",
  bpm: 71.5,
  pulseIndex: 80,
  fps: 30,
  waveform: [0, 0.5, -0.5, 1],
  timestamp: 2,
};

describe("/api/socket (live relay)", () => {
  it("accepts a valid alert and a valid telemetry frame", async () => {
    assert.equal((await socket.POST(post("http://x/api/socket", alert))).status, 200);
    assert.equal((await socket.POST(post("http://x/api/socket", telemetry))).status, 200);
  });

  for (const [name, body] of [
    ["malformed JSON", "{not json"],
    ["unknown status", { ...alert, status: "HACKED" }],
    ["unknown source", { ...alert, source: "evil" }],
    ["over-long session id", { ...alert, sessionId: "x".repeat(65) }],
    ["telemetry from an unknown source", { ...telemetry, source: "evil" }],
    ["telemetry waveform outside [-1, 1]", { ...telemetry, waveform: [0, 5] }],
    ["telemetry waveform too long", { ...telemetry, waveform: Array(129).fill(0) }],
    ["telemetry with non-numeric fps", { ...telemetry, fps: "fast" }],
  ]) {
    it(`rejects ${name} with 400`, async () => {
      assert.equal((await socket.POST(post("http://x/api/socket", body))).status, 400);
    });
  }

  it("streams alerts and telemetry to a connected proctor", async () => {
    const ctrl = new AbortController();
    const res = await socket.GET(new Request("http://x/api/socket", { signal: ctrl.signal }));
    assert.equal(res.headers.get("Content-Type"), "text/event-stream");
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    assert.match(dec.decode((await reader.read()).value), /connected/);

    await socket.POST(post("http://x/api/socket", alert));
    assert.match(dec.decode((await reader.read()).value), /"id":"a1"/);

    await socket.POST(post("http://x/api/socket", telemetry));
    const frame = dec.decode((await reader.read()).value);
    assert.match(frame, /^event: telemetry/);
    assert.match(frame, /"source":"meeting"/);

    ctrl.abort();
    await reader.cancel();
  });

  it("replays saved alerts to a proctor that connects later, skipping corrupt or edited lines", async () => {
    await socket.POST(post("http://x/api/socket", { ...alert, id: "saved-1" }));
    appendFileSync(join(process.env.DPZ_DATA_DIR, "alerts.jsonl"), "not json\n" + JSON.stringify({ ...alert, id: "x", status: "HACKED" }) + "\n");
    const ctrl = new AbortController();
    const reader = (await socket.GET(new Request("http://x/api/socket", { signal: ctrl.signal }))).body.getReader();
    const first = new TextDecoder().decode((await reader.read()).value);
    assert.match(first, /connected/);
    assert.match(first, /"id":"saved-1"/);
    assert.ok(!first.includes("HACKED") && !first.includes("not json"));
    ctrl.abort();
    await reader.cancel();
  });

  it("only forwards whitelisted fields", async () => {
    const ctrl = new AbortController();
    const reader = (await socket.GET(new Request("http://x/api/socket", { signal: ctrl.signal }))).body.getReader();
    await reader.read();
    await socket.POST(post("http://x/api/socket", { ...alert, id: "a2", extra: "<script>" }));
    const text = new TextDecoder().decode((await reader.read()).value);
    assert.ok(text.includes('"id":"a2"') && !text.includes("script"));
    ctrl.abort();
    await reader.cancel();
  });
});

describe("Proof-of-Pulse certificates", () => {
  it("keeps the same signing key across a server restart, in an owner-only file", () => {
    const before = signingKeys().publicKey.export({ type: "spki", format: "pem" });
    delete globalThis.__dpzKeys; // what a restart does to the in-memory copy
    assert.equal(signingKeys().publicKey.export({ type: "spki", format: "pem" }), before);
    if (process.platform !== "win32") assert.equal(statSync(join(process.env.DPZ_DATA_DIR, "cert-key.pem")).mode & 0o077, 0);
  });

  const passed = { session: "CAND-AB12", diff: 4.27, p: 0.004, beats: 46, cues: 8, startedAt: 1000, endedAt: 41000 };

  it("issues a certificate for a passed challenge that verifies", async () => {
    const res = await certRoute.POST(post("http://x/api/certificate", passed));
    assert.equal(res.status, 200);
    const { token } = await res.json();
    const v = await (await certRoute.GET(new Request(`http://x/api/certificate?t=${encodeURIComponent(token)}`))).json();
    assert.equal(v.valid, true);
    assert.equal(v.cert.session, "CAND-AB12");
    assert.equal(v.cert.diff, 4.3); // rounded
    assert.equal(v.cert.verdict, "PASS");
    assert.match(v.cert.id, /^[0-9a-f]{16}$/);
  });

  for (const [name, body] of [
    ["a failed challenge (p too high)", { ...passed, p: 0.5 }],
    ["a failed challenge (no heart response)", { ...passed, diff: 0.2 }],
    ["an unsafe session id", { ...passed, session: "<script>" }],
    ["an end time before the start", { ...passed, endedAt: 0 }],
    ["missing fields", { session: "CAND-AB12" }],
    ["malformed JSON", "{oops"],
  ]) {
    it(`refuses ${name}`, async () => {
      assert.equal((await certRoute.POST(post("http://x/api/certificate", body))).status, 400);
    });
  }

  it("ignores extra fields a client tries to sneak in", () => {
    const claims = parseClaims({ ...passed, verdict: "FAIL", v: 9, admin: true });
    assert.deepEqual(Object.keys(claims).sort(), ["beats", "cues", "diff", "endedAt", "p", "session", "startedAt"]);
  });

  it("rejects edited, re-signed, truncated and oversized tokens", async () => {
    const keys = signingKeys();
    const token = issue(parseClaims(passed), keys.privateKey);
    const [body, sig] = token.split(".");
    const cert = check(token, keys.publicKey);
    const edited = Buffer.from(JSON.stringify({ ...cert, session: "CAND-EVIL" })).toString("base64url");
    const otherServer = issue(parseClaims(passed), generateKeyPairSync("ed25519").privateKey);

    for (const bad of [`${edited}.${sig}`, `${body}.${sig.slice(0, -2)}AA`, body, otherServer, `${token}.extra`, "x".repeat(2001), ""]) {
      const v = await (await certRoute.GET(new Request(`http://x/api/certificate?t=${encodeURIComponent(bad)}`))).json();
      assert.equal(v.valid, false, `should reject: ${bad.slice(0, 40)}`);
    }
  });
});
