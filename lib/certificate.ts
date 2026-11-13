import { createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes, sign, verify, type KeyObject } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Local state (signing key, alert log). Never committed: see .gitignore. */
export const dataDir = () => process.env.DPZ_DATA_DIR ?? join(process.cwd(), ".data");

/** What the browser reports about a passed Breath Challenge. */
export interface CertClaims {
  session: string;
  /** inhale minus exhale heart rate, BPM */
  diff: number;
  /** permutation-test p-value */
  p: number;
  beats: number;
  cues: number;
  startedAt: number;
  endedAt: number;
}

export interface Certificate extends CertClaims {
  v: 1;
  id: string;
  verdict: "PASS";
  issuedAt: number;
}

// same pass rule as lib/breathChallenge.ts scoreChallenge
export const PASS_MIN_DIFF = 1.5;
export const PASS_MAX_P = 0.1;
export const MAX_TOKEN_LENGTH = 2000;

/** Validate untrusted claims; only whitelisted, well-formed fields survive. */
export function parseClaims(b: unknown): CertClaims | null {
  if (!b || typeof b !== "object") return null;
  const a = b as Record<string, unknown>;
  const num = (v: unknown) => typeof v === "number" && Number.isFinite(v);
  if (typeof a.session !== "string" || !/^[A-Za-z0-9-]{1,32}$/.test(a.session)) return null;
  if (![a.diff, a.p, a.beats, a.cues, a.startedAt, a.endedAt].every(num)) return null;
  const c = a as unknown as CertClaims;
  if (c.p < 0 || c.p > 1 || c.beats < 0 || c.beats > 1000 || c.cues < 1 || c.cues > 50 || c.endedAt <= c.startedAt) return null;
  if (c.diff < PASS_MIN_DIFF || c.p >= PASS_MAX_P) return null; // only a passed challenge earns a certificate
  return {
    session: c.session,
    diff: Math.round(c.diff * 10) / 10,
    p: Math.round(c.p * 1000) / 1000,
    beats: Math.round(c.beats),
    cues: Math.round(c.cues),
    startedAt: Math.round(c.startedAt),
    endedAt: Math.round(c.endedAt),
  };
}

/** token = base64url(JSON) "." base64url(Ed25519 signature over the first part) */
export function issue(claims: CertClaims, privateKey: KeyObject): string {
  const cert: Certificate = { ...claims, v: 1, id: randomBytes(8).toString("hex"), verdict: "PASS", issuedAt: Date.now() };
  const body = Buffer.from(JSON.stringify(cert)).toString("base64url");
  return `${body}.${sign(null, Buffer.from(body), privateKey).toString("base64url")}`;
}

/** The certificate if the signature is valid, else null. */
export function check(token: string, publicKey: KeyObject): Certificate | null {
  if (token.length > MAX_TOKEN_LENGTH) return null;
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  try {
    if (!verify(null, Buffer.from(parts[0]), publicKey, Buffer.from(parts[1], "base64url"))) return null;
    const cert = JSON.parse(Buffer.from(parts[0], "base64url").toString()) as Certificate;
    return cert.v === 1 && cert.verdict === "PASS" ? cert : null;
  } catch {
    return null;
  }
}

const g = globalThis as unknown as { __dpzKeys?: { privateKey: KeyObject; publicKey: KeyObject } };

/**
 * Signing key: DPZ_CERT_KEY (a base64 PKCS#8 Ed25519 PEM) if set, else a key created once in .data/cert-key.pem,
 * so certificates keep verifying after a restart.
 * shortcut: a key file on the server's disk; use a KMS or HSM before issuing certificates anyone relies on.
 */
export function signingKeys() {
  if (!g.__dpzKeys) {
    const privateKey = createPrivateKey(process.env.DPZ_CERT_KEY ? Buffer.from(process.env.DPZ_CERT_KEY, "base64").toString() : localKeyPem());
    g.__dpzKeys = { privateKey, publicKey: createPublicKey(privateKey) };
  }
  return g.__dpzKeys;
}

function localKeyPem(): string {
  const file = join(dataDir(), "cert-key.pem");
  try {
    return readFileSync(file, "utf8");
  } catch {
    const pem = generateKeyPairSync("ed25519").privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    mkdirSync(dataDir(), { recursive: true });
    try {
      writeFileSync(file, pem, { mode: 0o600, flag: "wx" }); // owner-only; "wx" never overwrites an existing key
      return pem;
    } catch {
      return readFileSync(file, "utf8"); // another request created it first
    }
  }
}
