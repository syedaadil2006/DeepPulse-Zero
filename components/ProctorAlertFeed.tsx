import type { AuditEntry } from "@/types";
import SecurityStatusBadge from "./SecurityStatusBadge";

const short = (h: string) => `0x${h.slice(0, 4)}...${h.slice(-3)}`;

export default function ProctorAlertFeed({ entries }: { entries: AuditEntry[] }) {
  return (
    <div className="overflow-x-auto rounded-3xl border border-bone/10 bg-ink/60 backdrop-blur">
      <table className="w-full min-w-[640px] text-left text-xs">
        <thead className="border-b border-bone/10 font-mono uppercase tracking-widest text-bone/40">
          <tr>
            <th className="px-4 py-3">Time</th>
            <th className="px-4 py-3">Session</th>
            <th className="px-4 py-3">Verdict</th>
            <th className="px-4 py-3">BPM</th>
            <th className="px-4 py-3">Pulse idx</th>
            <th className="px-4 py-3">Audit hash</th>
          </tr>
        </thead>
        <tbody>
          {entries.length === 0 && (
            <tr>
              <td colSpan={6} className="px-4 py-8 text-center text-bone/40">
                No verdicts yet. They appear here the moment a live scanner reaches one.
              </td>
            </tr>
          )}
          {entries.map((e) => (
            <tr key={e.hash} className={`border-b border-bone/5 ${e.status === "DEEPFAKE_DETECTED" ? "bg-synth/5" : ""}`}>
              <td className="px-4 py-2 font-mono text-bone/50">{new Date(e.timestamp).toLocaleTimeString()}</td>
              <td className="px-4 py-2 font-mono">
                {e.sessionId}
                {e.source === "live" && <span className="ml-2 rounded bg-pulse/15 px-1.5 text-[9px] text-pulse">LIVE</span>}
              </td>
              <td className="px-4 py-2">
                <SecurityStatusBadge status={e.status} compact />
              </td>
              <td className="px-4 py-2 font-mono">{e.bpm ? e.bpm.toFixed(0) : "--"}</td>
              <td className="px-4 py-2 font-mono">{e.pulseIndex}%</td>
              <td className="px-4 py-2 font-mono text-bone/70" title={`hash ${e.hash}\nprev ${e.prevHash}`}>
                {short(e.hash)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
