import type { Metrics } from "@/types";
import { BLOOD_ANGLE_MAX } from "@/lib/rppgEngine";

function Row({ label, value, unit, warn }: { label: string; value: string; unit: string; warn?: boolean }) {
  return (
    <div className="flex items-baseline justify-between border-b border-bone/10 py-2.5">
      <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-bone/40">{label}</span>
      <span className={`font-mono text-sm tabular-nums ${warn ? "text-synth" : "text-bone"}`}>
        {value}
        <span className="ml-1 text-bone/40">{unit}</span>
      </span>
    </div>
  );
}

export default function DiagnosticMetrics({ m }: { m: Metrics }) {
  const fake = m.status === "DEEPFAKE_DETECTED";
  const alive = m.status === "VERIFIED_HUMAN";
  const segs = 32;
  const lit = Math.round((m.pulseIndex / 100) * segs);
  return (
    <div>
      {/* giant heart rate */}
      <div className="flex items-end gap-3">
        <span
          className={`font-serif text-[clamp(4.5rem,9vw,7.5rem)] leading-none tabular-nums ${fake ? "text-synth/70 line-through decoration-1" : alive ? "text-bone" : "text-bone/30"}`}
        >
          {m.bpm && !fake ? m.bpm.toFixed(0) : "––"}
        </span>
        <div className="mb-3">
          <svg viewBox="0 0 24 24" className={`h-7 w-7 ${alive ? "beat fill-pulse" : "fill-bone/20"}`} aria-hidden>
            <path d="M12 21s-7.5-4.6-9.6-9.3C.9 8.3 3 4.5 6.6 4.5c2.1 0 3.6 1.2 4.4 2.6.8-1.4 2.3-2.6 4.4-2.6 3.6 0 5.7 3.8 4.2 7.2C19.5 16.4 12 21 12 21z" />
          </svg>
          <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-bone/40">bpm</div>
        </div>
      </div>

      {/* pulse index as a segmented capillary meter */}
      <div className="mt-6">
        <div className="mb-2 flex justify-between font-mono text-[10px] uppercase tracking-[0.3em] text-bone/40">
          <span>Biological pulse index</span>
          <span className={fake ? "text-synth" : "text-pulse"}>{m.pulseIndex}%</span>
        </div>
        <div className="flex h-6 gap-[3px]" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={m.pulseIndex} aria-label="Biological pulse index">
          {Array.from({ length: segs }, (_, i) => (
            <div
              key={i}
              className={`flex-1 rounded-[1px] transition-colors duration-300 ${
                i < lit ? (fake ? "bg-synth" : "bg-pulse shadow-[0_0_8px_rgba(255,59,92,0.7)]") : "bg-bone/10"
              }`}
              style={{ height: `${Math.round(40 + 60 * Math.sin((i / segs) * Math.PI))}%`, alignSelf: "center" }}
            />
          ))}
        </div>
      </div>

      <div className="mt-6">
        <Row label="Spectral SNR" value={m.snrDb.toFixed(1)} unit="dB" />
        <Row label="Frame latency" value={m.latencyMs.toFixed(1)} unit="ms" warn={m.latencyMs > 33} />
        <Row label="Throughput" value={m.fps.toFixed(0)} unit="fps" />
        <Row label="Face motion" value={m.motion.toFixed(1)} unit="‰" />
        <Row
          label="Face–neck sync (exp.)"
          value={m.neck ? m.neck.corr.toFixed(2) : "––"}
          unit={m.neck ? (m.neck.agree ? "in step" : "out of step") : "no neck"}
        />
        <Row
          label="Blood colour"
          value={m.blood ? m.blood.angle.toFixed(0) : "––"}
          unit={m.blood ? `° off${m.blood.inPhase ? "" : " · out of phase"}` : ""}
          warn={!!m.blood && m.blood.angle > BLOOD_ANGLE_MAX}
        />
        <Row label="Signal buffer" value={String(Math.round(m.bufferFill * 256))} unit="/ 256" />
        <Row label="Video uplink" value="0" unit="bytes" />
      </div>
    </div>
  );
}
