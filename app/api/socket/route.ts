import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { AlertEvent, LivenessStatus, Telemetry } from "@/types";
import { dataDir } from "../../../lib/certificate.ts"; // relative + .ts so node:test can import this route

export const dynamic = "force-dynamic";

// shortcut: in-memory fan-out over Server-Sent Events, single server process only; swap for Redis pub/sub when scaling out
const g = globalThis as unknown as { __dpzClients?: Set<ReadableStreamDefaultController<Uint8Array>> };
const clients = (g.__dpzClients ??= new Set());
const enc = new TextEncoder();

// Verdicts (never telemetry or video) are kept in .data/alerts.jsonl so the proctor log survives a restart.
const alertLog = () => join(dataDir(), "alerts.jsonl");
const REPLAY = 200;

function saveAlert(a: AlertEvent) {
  try {
    mkdirSync(dataDir(), { recursive: true });
    appendFileSync(alertLog(), JSON.stringify(a) + "\n");
  } catch (e) {
    console.error("alert log write failed:", e); // the live relay still works without the file
  }
}

/** Latest saved alerts, re-validated: the file is outside the request path but could still be edited. */
function recentAlerts(): AlertEvent[] {
  let text = "";
  try {
    text = readFileSync(alertLog(), "utf8");
  } catch {
    return [];
  }
  // shortcut: reads the whole file on each proctor connect; rotate it or move to a database past ~10k alerts
  return text.split("\n").filter(Boolean).slice(-REPLAY).flatMap((line) => {
    try {
      const a = parseAlert(JSON.parse(line));
      return a ? [a] : [];
    } catch {
      return [];
    }
  });
}

const STATUSES: LivenessStatus[] =["IDLE", "NO_FACE", "CALIBRATING", "VERIFIED_HUMAN", "DEEPFAKE_DETECTED"];

function parseAlert(b: unknown): AlertEvent | null {
  if (!b || typeof b !== "object") return null;
  const a = b as Record<string, unknown>;
  const str = (v: unknown) => typeof v === "string" && v.length > 0 && v.length <= 64;
  const num = (v: unknown) => typeof v === "number" && Number.isFinite(v);
  if (!str(a.id) || !str(a.sessionId)) return null;
  if (a.source !== "live" && a.source !== "simulated") return null;
  if (!STATUSES.includes(a.status as LivenessStatus)) return null;
  if (!(a.bpm === null || num(a.bpm)) || !num(a.pulseIndex) || !num(a.timestamp)) return null;
  return {
    id: a.id as string,
    sessionId: a.sessionId as string,
    source: a.source,
    status: a.status as LivenessStatus,
    bpm: a.bpm as number | null,
    pulseIndex: a.pulseIndex as number,
    timestamp: a.timestamp as number,
  };
}

function parseTelemetry(b: unknown): Telemetry | null {
  if (!b || typeof b !== "object") return null;
  const a = b as Record<string, unknown>;
  const num = (v: unknown) => typeof v === "number" && Number.isFinite(v);
  if (a.kind !== "telemetry" || typeof a.sessionId !== "string" || !a.sessionId || a.sessionId.length > 64) return null;
  if (a.source !== "camera" && a.source !== "upload" && a.source !== "meeting") return null;
  if (!STATUSES.includes(a.status as LivenessStatus)) return null;
  if (!(a.bpm === null || num(a.bpm)) || !num(a.pulseIndex) || !num(a.fps) || !num(a.timestamp)) return null;
  if (!Array.isArray(a.waveform) || a.waveform.length > 128 || !a.waveform.every((v) => num(v) && Math.abs(v) <= 1)) return null;
  return {
    kind: "telemetry",
    sessionId: a.sessionId,
    source: a.source,
    status: a.status as LivenessStatus,
    bpm: a.bpm as number | null,
    pulseIndex: a.pulseIndex as number,
    fps: a.fps as number,
    waveform: a.waveform as number[],
    timestamp: a.timestamp as number,
  };
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  let frame: Uint8Array;
  if ((body as { kind?: unknown } | null)?.kind === "telemetry") {
    const t = parseTelemetry(body);
    if (!t) return Response.json({ error: "invalid telemetry" }, { status: 400 });
    frame = enc.encode(`event: telemetry\ndata: ${JSON.stringify(t)}\n\n`);
  } else {
    const alert = parseAlert(body);
    if (!alert) return Response.json({ error: "invalid alert" }, { status: 400 });
    saveAlert(alert);
    frame = enc.encode(`data: ${JSON.stringify(alert)}\n\n`);
  }
  for (const c of clients) {
    try {
      c.enqueue(frame);
    } catch {
      clients.delete(c);
    }
  }
  return Response.json({ ok: true, delivered: clients.size });
}

export async function GET(req: Request) {
  let ctrl: ReadableStreamDefaultController<Uint8Array>;
  let ping: ReturnType<typeof setInterval>;
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      ctrl = c;
      clients.add(c);
      // history rides in the first chunk so the proctor rebuilds the same hash chain after a restart
      c.enqueue(enc.encode(": connected\n\n" + recentAlerts().map((a) => `data: ${JSON.stringify(a)}\n\n`).join("")));
      ping = setInterval(() => {
        try {
          c.enqueue(enc.encode(": ping\n\n"));
        } catch {
          clearInterval(ping);
          clients.delete(c);
        }
      }, 15000);
    },
    cancel() {
      clearInterval(ping);
      clients.delete(ctrl);
    },
  });
  req.signal.addEventListener("abort", () => {
    clearInterval(ping);
    clients.delete(ctrl);
  });
  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" },
  });
}
