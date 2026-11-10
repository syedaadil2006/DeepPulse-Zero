import { Loader2, ScanFace, ShieldAlert, ShieldCheck, UserX } from "lucide-react";
import type { LivenessStatus } from "@/types";

const MAP: Record<LivenessStatus, { word: string; label: string; sub: string; tone: string; cls: string; Icon: typeof ShieldCheck }> = {
  IDLE: { word: "Standby.", label: "STANDBY", sub: "The lens is closed.", tone: "text-bone/40", cls: "border-bone/20 text-bone/50", Icon: ScanFace },
  NO_FACE: { word: "No one.", label: "NO FACE", sub: "Bring a face into the lens.", tone: "text-amber-200/80", cls: "border-amber-300/40 text-amber-200", Icon: UserX },
  CALIBRATING: { word: "Listening…", label: "LISTENING", sub: "Reading light through the skin.", tone: "text-bone/80", cls: "border-bone/30 text-bone/80", Icon: Loader2 },
  VERIFIED_HUMAN: {
    word: "Alive.",
    label: "ALIVE",
    sub: "Blood is moving under this face.",
    tone: "text-pulse",
    cls: "border-pulse/60 text-pulse bg-pulse/10",
    Icon: ShieldCheck,
  },
  DEEPFAKE_DETECTED: {
    word: "Synthetic.",
    label: "SYNTHETIC",
    sub: "A face that moves, but does not bleed.",
    tone: "text-synth",
    cls: "border-synth text-synth bg-synth/10 animate-alarm",
    Icon: ShieldAlert,
  },
};

export default function SecurityStatusBadge({ status, compact = false }: { status: LivenessStatus; compact?: boolean }) {
  const { word, label, sub, tone, cls, Icon } = MAP[status];
  if (compact)
    return (
      <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 font-mono text-[10px] tracking-[0.2em] ${cls}`}>
        <Icon className={`h-3 w-3 ${status === "CALIBRATING" ? "animate-spin" : ""}`} />
        {label}
      </span>
    );
  return (
    <div role="status" aria-live="assertive">
      <div className="font-mono text-[10px] uppercase tracking-[0.35em] text-bone/40">Verdict</div>
      <div
        key={status}
        data-text={word}
        className={`mt-1 font-serif text-[clamp(3.5rem,8vw,6.5rem)] italic leading-[0.9] ${tone} ${status === "DEEPFAKE_DETECTED" ? "glitch" : ""}`}
      >
        {word}
      </div>
      <div className="mt-3 text-sm text-bone/60">{sub}</div>
    </div>
  );
}
