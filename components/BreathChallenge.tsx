import type { ChallengeResult, Phase } from "@/lib/breathChallenge";

export interface CoachView {
  kind: "ready" | "in" | "out";
  secondsLeft: number;
  phaseMs: number;
  step: number;
  steps: number;
}

/** Breathing coach drawn over the scanner lens. */
export function BreathOverlay({ view }: { view: CoachView }) {
  const label = view.kind === "ready" ? "Get ready" : view.kind === "in" ? "Breathe in" : "Breathe out";
  return (
    <div className="pointer-events-none absolute inset-[15%] flex items-center justify-center rounded-full">
      <div
        className="absolute inset-0 rounded-full border-2 border-bone/70 bg-ink/40 ease-in-out"
        style={{
          transform: `scale(${view.kind === "in" ? 1 : 0.72})`,
          transitionProperty: "transform",
          transitionDuration: `${view.phaseMs}ms`,
        }}
      />
      <div className="relative text-center" aria-live="assertive">
        <div className="font-serif text-5xl italic text-bone drop-shadow-[0_2px_12px_rgba(0,0,0,0.9)]">{label}</div>
        <div className="mt-2 font-mono text-xs uppercase tracking-[0.3em] text-bone/80">
          {view.secondsLeft}s{view.kind !== "ready" && ` · ${view.step}/${view.steps}`}
        </div>
      </div>
    </div>
  );
}

/** Result card: heart rate per beat over the randomized breathing cues. */
export function BreathResult({ result, phases }: { result: ChallengeResult; phases: Phase[] }) {
  const t0 = phases[0].start;
  const span = phases[phases.length - 1].end - t0;
  const hrs = result.points.map((p) => p.hr);
  const lo = Math.min(...hrs, 60) - 3;
  const hi = Math.max(...hrs, 90) + 3;
  const x = (t: number) => ((t - t0) / span) * 300;
  const y = (hr: number) => 90 - ((hr - lo) / (hi - lo)) * 90;
  const tone = result.verdict === "PASS" ? "text-pulse" : result.verdict === "FAIL" ? "text-synth" : "text-amber-200";
  const word = result.verdict === "PASS" ? "The heart answered." : result.verdict === "FAIL" ? "No answer from the heart." : "Inconclusive.";

  return (
    <div role="status" className="mt-6 rounded-3xl border border-bone/15 bg-ink/70 p-5 backdrop-blur">
      <div className="font-mono text-[10px] uppercase tracking-[0.35em] text-bone/40">Breath challenge</div>
      <div className={`mt-1 font-serif text-4xl italic ${tone}`}>{word}</div>

      <svg viewBox="0 0 300 90" className="mt-4 h-24 w-full overflow-visible" role="img" aria-label="Heart rate per beat against breathing cues">
        {phases.map((p) => (
          <rect key={p.start} x={x(p.start)} y={0} width={x(p.end) - x(p.start)} height={90} fill={p.kind === "in" ? "rgba(255,59,92,0.12)" : "transparent"} />
        ))}
        {result.points
          .filter((p) => p.t >= t0 && p.t <= t0 + span)
          .map((p) => (
            <circle key={p.t} cx={x(p.t)} cy={y(p.hr)} r={2.4} fill={p.cue === 1 ? "#ff3b5c" : "#f1e9df"} opacity={p.cue === 0 ? 0.3 : 0.9} />
          ))}
      </svg>
      <div className="mt-1 flex justify-between font-mono text-[10px] uppercase tracking-[0.25em] text-bone/40">
        <span>
          <span className="text-pulse">■</span> breathe in
        </span>
        <span>beat-to-beat heart rate</span>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2 font-mono text-xs">
        {[
          ["Inhale lift", `${result.diff >= 0 ? "+" : ""}${result.diff.toFixed(1)} bpm`],
          ["Chance", `p = ${result.p.toFixed(3)}`],
          ["Beats", String(result.points.length)],
        ].map(([k, v]) => (
          <div key={k}>
            <div className="text-[10px] uppercase tracking-[0.3em] text-bone/40">{k}</div>
            <div className="mt-1 text-bone">{v}</div>
          </div>
        ))}
      </div>
      <p className="mt-4 text-[11px] leading-relaxed text-bone/50">
        {result.verdict === "INCONCLUSIVE"
          ? "Too few clean heartbeats. Sit still, face a light, and try again."
          : "A live heart speeds up slightly on each in-breath (respiratory sinus arrhythmia). The cues were random, so a replayed or copied pulse can't follow them. A face-swap driven live by someone who also breathes along can still pass."}
      </p>
    </div>
  );
}
