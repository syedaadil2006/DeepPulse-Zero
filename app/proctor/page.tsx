"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Fingerprint, HeartPulse, Radio, ScanFace, ShieldAlert } from "lucide-react";
import EcgWaveformCanvas from "@/components/EcgWaveformCanvas";
import SecurityStatusBadge from "@/components/SecurityStatusBadge";
import ProctorAlertFeed from "@/components/ProctorAlertFeed";
import { subscribeAlerts } from "@/lib/socketClient";
import type { AlertEvent, AuditEntry, Telemetry } from "@/types";

interface Stream {
  t: Telemetry;
  lastSeen: number;
}

const STALE_MS = 3000; // no telemetry for 3 s → signal lost
const DROP_MS = 60000; // forget a session after a minute of silence

const GENESIS = "0".repeat(64);

async function sha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

export default function ProctorPage() {
  const [streams, setStreams] = useState<Record<string, Stream>>({});
  const [log, setLog] = useState<AuditEntry[]>([]);
  const [connected, setConnected] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const chain = useRef<Promise<string>>(Promise.resolve(GENESIS));
  const seen = useRef(new Set<string>()); // a reconnect replays saved history; chain each alert once

  // tamper-evident log: hash_n = SHA-256(hash_{n-1} || entry)
  const record = useCallback((a: AlertEvent) => {
    if (seen.current.has(a.id)) return;
    seen.current.add(a.id);
    chain.current = chain.current.then(async (prevHash) => {
      const hash = await sha256(prevHash + JSON.stringify(a));
      setLog((l) => [{ ...a, prevHash, hash }, ...l].slice(0, 200));
      return hash;
    });
  }, []);

  useEffect(
    () =>
      subscribeAlerts(record, setConnected, (t) =>
        setStreams((ss) => ({ ...ss, [t.sessionId]: { t, lastSeen: Date.now() } })),
      ),
    [record],
  );

  // clock for "signal lost" detection; drop long-silent sessions
  useEffect(() => {
    const id = setInterval(() => {
      const n = Date.now();
      setNow(n);
      setStreams((ss) => {
        const stale = Object.keys(ss).filter((k) => n - ss[k].lastSeen > DROP_MS);
        if (!stale.length) return ss;
        const next = { ...ss };
        stale.forEach((k) => delete next[k]);
        return next;
      });
    }, 1000);
    return () => clearInterval(id);
  }, []);

  const list = Object.values(streams).sort((a, b) => a.t.sessionId.localeCompare(b.t.sessionId));
  const online = list.filter((s) => now - s.lastSeen <= STALE_MS);
  const incidents = log.filter((e) => e.status === "DEEPFAKE_DETECTED").length;
  const active = online.filter((s) => s.t.status === "DEEPFAKE_DETECTED").length;

  return (
    <main className="mx-auto max-w-[1400px] px-4 py-6 sm:px-8">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-baseline gap-2">
            <span className="font-serif text-3xl italic">DeepPulse</span>
            <span className="font-mono text-xs tracking-[0.3em] text-pulse">/PROCTOR ROOM</span>
          </div>
          <h1 className="mt-6 font-serif text-[clamp(2.4rem,5vw,4rem)] leading-none">
            Who here is <em className="text-pulse">bleeding</em>?
          </h1>
          <p className="mt-2 text-sm text-bone/50">Every candidate&apos;s pulse, side by side. Every verdict, sealed in a hash chain.</p>
        </div>
        <div className="flex items-center gap-3 font-mono text-xs">
          <span className={`flex items-center gap-1.5 ${connected ? "text-pulse" : "text-amber-200"}`}>
            <Radio className="h-4 w-4" /> {connected ? "RELAY CONNECTED" : "RELAY OFFLINE"}
          </span>
          <Link href="/" className="rounded-full border border-bone/20 px-4 py-2 uppercase tracking-[0.2em] hover:bg-bone hover:text-ink">
            Scanner
          </Link>
        </div>
      </header>

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "Live candidates", value: online.length, Icon: ScanFace },
          { label: "Active threats", value: active, Icon: ShieldAlert, warn: active > 0 },
          { label: "Incidents logged", value: incidents, Icon: HeartPulse },
          { label: "Chain head", value: log[0] ? `0x${log[0].hash.slice(0, 4)}...${log[0].hash.slice(-3)}` : "genesis", Icon: Fingerprint },
        ].map(({ label, value, Icon, warn }) => (
          <div key={label} className={`rounded-xl border bg-ink/60 p-3 backdrop-blur ${warn ? "border-synth/60" : "border-bone/10"}`}>
            <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-widest text-bone/40">
              <Icon className="h-3 w-3" /> {label}
            </div>
            <div className={`mt-1 font-serif text-4xl ${warn ? "text-synth" : ""}`}>{value}</div>
          </div>
        ))}
      </div>

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {list.length === 0 && (
          <div className="col-span-full rounded-3xl border border-dashed border-bone/15 p-10 text-center">
            <div className="font-serif text-3xl italic text-bone/60">The room is empty.</div>
            <p className="mt-2 text-sm text-bone/40">
              Open the{" "}
              <Link href="/" target="_blank" className="text-pulse underline-offset-4 hover:underline">
                scanner
              </Link>{" "}
              in another tab or on another device on this network. Each live candidate appears here within half a second.
            </p>
          </div>
        )}
        {list.map(({ t, lastSeen }) => {
          const lost = now - lastSeen > STALE_MS;
          const fake = !lost && t.status === "DEEPFAKE_DETECTED";
          return (
            <div
              key={t.sessionId}
              className={`rounded-3xl border bg-ink/60 p-4 backdrop-blur transition ${
                lost ? "border-bone/10 opacity-50" : fake ? "border-synth shadow-[0_0_30px_rgba(110,240,255,0.35)]" : "border-bone/10"
              }`}
            >
              <div className="mb-2 flex items-center justify-between">
                <div>
                  <div className="font-serif text-xl italic">{t.sessionId}</div>
                  <div className="font-mono text-[10px] text-bone/40">
                    {lost ? (
                      <span className="text-amber-200">signal lost · {Math.round((now - lastSeen) / 1000)}s ago</span>
                    ) : (
                      <span className="text-pulse">● {t.source === "upload" ? "uploaded video" : t.source === "meeting" ? "meeting screen" : "live camera"} · {t.fps.toFixed(0)} fps</span>
                    )}
                  </div>
                </div>
                <SecurityStatusBadge status={lost ? "IDLE" : t.status} compact />
              </div>
              <EcgWaveformCanvas waveform={lost ? [] : t.waveform} alarm={fake} height={60} />
              <div className="mt-2 flex justify-between font-mono text-xs text-bone/50">
                <span>{fake || lost || !t.bpm ? "-- BPM" : `${t.bpm.toFixed(0)} BPM`}</span>
                <span>pulse idx {lost ? 0 : t.pulseIndex}%</span>
              </div>
            </div>
          );
        })}
      </div>

      <h2 className="mb-3 font-mono text-[10px] uppercase tracking-[0.35em] text-bone/40">Security event log · SHA-256 hash chain</h2>
      <ProctorAlertFeed entries={log} />
    </main>
  );
}
