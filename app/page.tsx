"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Camera, FileVideo, Image as ImageIcon, Lock, MonitorPlay, Upload } from "lucide-react";
import ScannerFeed from "@/components/ScannerFeed";
import EcgWaveformCanvas from "@/components/EcgWaveformCanvas";
import SecurityStatusBadge from "@/components/SecurityStatusBadge";
import DiagnosticMetrics from "@/components/DiagnosticMetrics";
import PulseHalo from "@/components/PulseHalo";
import ProofOfPulse from "@/components/ProofOfPulse";
import PhotoCheck from "@/components/PhotoCheck";
import { BreathOverlay, BreathResult, type CoachView } from "@/components/BreathChallenge";
import { makePhases, RSA_LAG_MS, scoreChallenge, type ChallengeResult, type Phase } from "@/lib/breathChallenge";
import { emitAlert, emitTelemetry } from "@/lib/socketClient";
import type { FaceSummary, LivenessStatus, Metrics } from "@/types";
import { BLOOD_ANGLE_MAX, VIDEO_AI_MIN, videoSuspicious } from "@/lib/rppgEngine";

const EMPTY: Metrics = { status: "IDLE", bpm: null, pulseIndex: 0, snrDb: 0, fps: 0, latencyMs: 0, motion: 0, bufferFill: 0, waveform: [], beats: [], neck: null, blood: null };

export default function ScannerPage() {
  const [metrics, setMetrics] = useState<Metrics>(EMPTY);
  const [attack, setAttack] = useState(false);
  const [sessionId, setSessionId] = useState("");
  const lastStatus = useRef(EMPTY.status);
  const [file, setFile] = useState<File | null>(null);
  const [photo, setPhoto] = useState<File | null>(null);
  const [meeting, setMeeting] = useState(false);
  const [faces, setFaces] = useState<FaceSummary[]>([]);
  const [runId, setRunId] = useState(0); // remounts the scanner, e.g. to re-pick a meeting window
  const tally = useRef({ human: 0, fake: 0, bpms: [] as number[], neckAgree: 0, neckTotal: 0, corrs: [] as number[], angles: [] as number[], inPhase: 0 });
  const [report, setReport] = useState<null | ReportData>(null);
  // breath challenge: randomized breathing cues, beats collected on the scanner's performance.now() clock
  const challenge = useRef<{ phases: Phase[]; beats: number[]; timer: ReturnType<typeof setInterval> } | null>(null);
  const [coach, setCoach] = useState<CoachView | null>(null);
  const [breath, setBreath] = useState<{ result: ChallengeResult; phases: Phase[] } | null>(null);

  const stopChallenge = () => {
    if (challenge.current) clearInterval(challenge.current.timer);
    challenge.current = null;
    setCoach(null);
  };
  useEffect(() => stopChallenge, []);

  const startChallenge = () => {
    stopChallenge();
    setBreath(null);
    const phases = makePhases(performance.now() + 3000);
    const timer = setInterval(() => {
      const c = challenge.current;
      if (!c) return;
      const now = performance.now();
      const last = phases[phases.length - 1];
      if (now > last.end + RSA_LAG_MS + 1500) {
        setBreath({ result: scoreChallenge(c.beats, phases), phases });
        stopChallenge();
        return;
      }
      const i = phases.findIndex((p) => now >= p.start && now < p.end);
      const p = phases[i];
      setCoach(
        now < phases[0].start
          ? { kind: "ready", secondsLeft: Math.ceil((phases[0].start - now) / 1000), phaseMs: 300, step: 0, steps: phases.length }
          : p
            ? { kind: p.kind, secondsLeft: Math.ceil((p.end - now) / 1000), phaseMs: p.end - p.start, step: i + 1, steps: phases.length }
            : { kind: "out", secondsLeft: 0, phaseMs: 300, step: phases.length, steps: phases.length },
      );
    }, 100);
    challenge.current = { phases, beats: [], timer };
  };

  useEffect(() => setSessionId(`CAND-${Math.random().toString(36).slice(2, 6).toUpperCase()}`), []);

  const onMetrics = useCallback((m: Metrics) => {
    setMetrics(m);
    const t = tally.current;
    if (m.status === "VERIFIED_HUMAN") t.human++;
    else if (m.status === "DEEPFAKE_DETECTED") t.fake++;
    if (m.bpm) t.bpms.push(m.bpm);
    if (m.blood && m.status !== "CALIBRATING") {
      t.angles.push(m.blood.angle);
      if (m.blood.inPhase) t.inPhase++;
    }
    if (m.neck) {
      t.neckTotal++;
      if (m.neck.agree) t.neckAgree++;
      t.corrs.push(m.neck.corr);
    }
    // the same beat shows up in many overlapping windows; keep one copy
    const c = challenge.current;
    if (c) for (const b of m.beats) if (!c.beats.some((x) => Math.abs(x - b) < 200)) c.beats.push(b);
  }, []);

  const pickFile = (f: File | null, meetingMode = false) => {
    tally.current = { human: 0, fake: 0, bpms: [] as number[], neckAgree: 0, neckTotal: 0, corrs: [] as number[], angles: [] as number[], inPhase: 0 };
    doneRef.current = false;
    stopChallenge();
    setBreath(null);
    setReport(null);
    setAttack(false);
    setMetrics(EMPTY);
    setFaces([]);
    setMeeting(meetingMode);
    setRunId((n) => n + 1);
    setPhoto(null);
    setFile(f);
  };

  // photos skip the pulse scanner entirely (no heartbeat in a still image)
  const pickPhoto = (f: File | null) => {
    if (!f) return;
    pickFile(null);
    setPhoto(f);
  };

  const onEnded = useCallback((imageAi: number | null) => {
    doneRef.current = true;
    const { human, fake, bpms, neckAgree, neckTotal, corrs, angles, inPhase } = tally.current;
    setReport({ human, fake, bpm: median(bpms), neckAgree, neckTotal, neckCorr: median(corrs), bloodAngle: median(angles), bloodInPhase: angles.length ? inPhase / angles.length : 0, imageAi });
  }, []);

  // broadcast verdict transitions (metadata only) to the proctor dashboard
  useEffect(() => {
    const s = metrics.status;
    if (s === lastStatus.current || !sessionId) return;
    lastStatus.current = s;
    if (s === "DEEPFAKE_DETECTED" || s === "VERIFIED_HUMAN") {
      emitAlert({ id: crypto.randomUUID(), sessionId, source: "live", status: s, bpm: metrics.bpm, pulseIndex: metrics.pulseIndex, timestamp: Date.now() });
    }
  }, [metrics, sessionId]);

  // stream live vitals to the proctor room twice a second
  const metricsRef = useRef(metrics);
  metricsRef.current = metrics;
  const doneRef = useRef(false);
  const sourceRef = useRef<"camera" | "upload" | "meeting">("camera");
  sourceRef.current = file ? "upload" : meeting ? "meeting" : "camera";
  useEffect(() => {
    if (!sessionId) return;
    const id = setInterval(() => {
      const m = metricsRef.current;
      if (m.status === "IDLE" || doneRef.current) return; // finished uploads stop streaming
      const wf = m.waveform.slice(-128).filter((_, i) => i % 2 === 0).map((v) => Math.round(v * 1000) / 1000);
      emitTelemetry({ kind: "telemetry", sessionId, source: sourceRef.current, status: m.status, bpm: m.bpm, pulseIndex: m.pulseIndex, fps: m.fps, waveform: wf, timestamp: Date.now() });
    }, 500);
    return () => clearInterval(id);
  }, [sessionId]);

  const fake = metrics.status === "DEEPFAKE_DETECTED";
  const alive = metrics.status === "VERIFIED_HUMAN";
  // the verdict stays readable from the tab strip while you are in the meeting's own tab
  useEffect(() => {
    document.title = `${fake ? "⚠ Synthetic · " : alive ? "♥ Alive · " : ""}DeepPulse-Zero`;
  }, [fake, alive]);

  // heartbeat tempo drives the CSS heart animation
  useEffect(() => {
    document.documentElement.style.setProperty("--beat", `${60 / (metrics.bpm && alive ? metrics.bpm : 60)}s`);
  }, [metrics.bpm, alive]);

  const onPointerMove = (e: React.PointerEvent) => {
    document.documentElement.style.setProperty("--mx", `${e.clientX}px`);
    document.documentElement.style.setProperty("--my", `${e.clientY}px`);
  };

  return (
    <main onPointerMove={onPointerMove} className="relative min-h-screen overflow-x-hidden">
      <Veins tone={fake ? "synth" : "pulse"} />

      <header className="relative z-10 mx-auto flex max-w-[1400px] flex-wrap items-center justify-between gap-4 px-4 py-5 sm:px-8">
        <div className="flex items-baseline gap-2">
          <span className="font-serif text-3xl italic">DeepPulse</span>
          <span className="font-mono text-xs tracking-[0.3em] text-pulse">/ZERO</span>
        </div>
        <nav className="flex items-center gap-5 font-mono text-[11px] uppercase tracking-[0.25em] text-bone/50">
          <span className="hidden sm:inline">Session · {sessionId || "…"}</span>
          <Link href="/proctor" target="_blank" className="group flex items-center gap-1 text-bone hover:text-pulse">
            Proctor room <ArrowUpRight className="h-3.5 w-3.5 transition group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
          </Link>
        </nav>
      </header>

      <section className="relative z-10 mx-auto grid max-w-[1400px] items-center gap-10 px-4 pb-10 pt-4 sm:px-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,560px)_minmax(0,1fr)]">
        {/* left: thesis + controls */}
        <div className="order-2 lg:order-1">
          <div className="font-mono text-[10px] uppercase tracking-[0.35em] text-bone/40">Sub-dermal liveness · 100% in-browser</div>
          <h1 className="mt-4 font-serif text-[clamp(2.6rem,5vw,4.6rem)] leading-[0.95]">
            Is there <em className="text-pulse">blood</em>
            <br />
            behind the face?
          </h1>
          <p className="mt-5 max-w-sm text-sm leading-relaxed text-bone/60">
            Every heartbeat flushes your skin with a trace of colour no eye can see. A camera can. Deepfakes can copy a face, even a pulse, but not a heart that answers a question asked right now.
          </p>

          <div className="mt-8 inline-flex rounded-full border border-bone/15 p-1 font-mono text-[11px] uppercase tracking-[0.2em]">
            <button
              onClick={() => pickFile(null)}
              aria-pressed={!file && !meeting && !photo}
              className={`flex items-center gap-2 rounded-full px-4 py-2 transition ${!file && !meeting && !photo ? "bg-bone text-ink" : "text-bone/60 hover:text-bone"}`}
            >
              <Camera className="h-3.5 w-3.5" /> Live
            </button>
            <button
              onClick={() => pickFile(null, true)}
              aria-pressed={meeting}
              className={`flex items-center gap-2 rounded-full px-4 py-2 transition ${meeting ? "bg-bone text-ink" : "text-bone/60 hover:text-bone"}`}
            >
              <MonitorPlay className="h-3.5 w-3.5" /> Meeting
            </button>
            <label
              className={`flex cursor-pointer items-center gap-2 rounded-full px-4 py-2 transition focus-within:ring-2 focus-within:ring-pulse ${
                file ? "bg-bone text-ink" : "text-bone/60 hover:text-bone"
              }`}
            >
              <Upload className="h-3.5 w-3.5" /> Upload
              <input
                type="file"
                accept="video/*"
                className="sr-only"
                onChange={(e) => {
                  const f = e.target.files?.[0] ?? null;
                  f?.type.startsWith("image/") ? pickPhoto(f) : pickFile(f); // a photo picked here still gets the photo check
                  e.target.value = "";
                }}
              />
            </label>
            <label
              className={`flex cursor-pointer items-center gap-2 rounded-full px-4 py-2 transition focus-within:ring-2 focus-within:ring-pulse ${
                photo ? "bg-bone text-ink" : "text-bone/60 hover:text-bone"
              }`}
            >
              <ImageIcon className="h-3.5 w-3.5" /> Photo
              <input
                type="file"
                accept="image/*"
                className="sr-only"
                onChange={(e) => {
                  const f = e.target.files?.[0] ?? null;
                  f?.type.startsWith("video/") ? pickFile(f) : pickPhoto(f);
                  e.target.value = "";
                }}
              />
            </label>
          </div>
          {photo && (
            <div className="mt-3 flex min-w-0 items-center gap-2 font-mono text-[11px] text-bone/50">
              <ImageIcon className="h-3.5 w-3.5 shrink-0" /> <span className="truncate">{photo.name}</span>
            </div>
          )}
          {meeting && (
            <p className="mt-3 max-w-sm text-xs leading-relaxed text-bone/50">
              Share your Zoom, Google Meet, Teams or Webex window (or its browser tab). Every visible face is checked live, in this tab only. Use
              speaker or gallery view with faces large and well lit, and get participants&apos; consent first: pulse data is biometric.
            </p>
          )}
          {file && (
            <div className="mt-3 flex min-w-0 items-center gap-2 font-mono text-[11px] text-bone/50">
              <FileVideo className="h-3.5 w-3.5 shrink-0" /> <span className="truncate">{file.name}</span>
            </div>
          )}

          {!file && !meeting && !photo && (
            <button
              role="switch"
              aria-checked={attack}
              onClick={() => setAttack((a) => !a)}
              className="mt-8 flex w-full max-w-sm items-center justify-between gap-4 rounded-2xl border border-bone/15 p-4 text-left transition hover:border-synth/60"
            >
              <span>
                <span className="block font-mono text-[10px] uppercase tracking-[0.3em] text-synth">Red-team</span>
                <span className="mt-1 block font-serif text-xl italic">{attack ? "Synthetic feed injected" : "Inject a synthetic feed"}</span>
                <span className="block text-xs text-bone/50">Freezes the skin signal while the face keeps moving.</span>
              </span>
              <span className={`relative h-7 w-12 shrink-0 rounded-full transition ${attack ? "bg-synth" : "bg-bone/15"}`}>
                <span className={`absolute top-1 h-5 w-5 rounded-full bg-ink transition-all ${attack ? "left-6" : "left-1"}`} />
              </span>
            </button>
          )}

          {!file && !photo && (
            <button
              onClick={coach ? stopChallenge : startChallenge}
              disabled={attack}
              className="mt-4 flex w-full max-w-sm items-center justify-between gap-4 rounded-2xl border border-pulse/30 p-4 text-left transition hover:border-pulse disabled:opacity-40"
            >
              <span>
                <span className="block font-mono text-[10px] uppercase tracking-[0.3em] text-pulse">Breath challenge · ~40 s</span>
                <span className="mt-1 block font-serif text-xl italic">{coach ? "Stop the challenge" : "Ask the heart a question"}</span>
                <span className="block text-xs text-bone/50">Follow random breathing cues. A live heart answers; a copied pulse can&apos;t.</span>
              </span>
              <span className={`h-3 w-3 shrink-0 rounded-full ${coach ? "beat bg-pulse" : "bg-pulse/40"}`} />
            </button>
          )}
        </div>

        {/* center: the lens */}
        <div className="order-1 mx-auto w-full max-w-[560px] lg:order-2 lg:self-start">
          {photo ? (
            <PhotoCheck file={photo} />
          ) : (
          <>
          <div className="relative aspect-square w-full">
            <PulseHalo waveform={metrics.waveform} bpm={metrics.bpm} status={metrics.status} lens={0.7} />
            <div className="absolute inset-[15%]">
              <ScannerFeed key={runId} onRetry={() => setRunId((n) => n + 1)} attackMode={attack} onMetrics={onMetrics} file={file} screen={meeting} onFaces={setFaces} onEnded={onEnded} />
            </div>
            {coach && <BreathOverlay view={coach} />}
          </div>
          <div className="mt-2 text-center font-mono text-[10px] uppercase tracking-[0.35em] text-bone/35">
            478 landmarks · forehead + cheek capillaries · 0.7–3.0 Hz
          </div>
          {report && <VideoReport {...report} />}
          {breath && <BreathResult result={breath.result} phases={breath.phases} />}
          {breath && <ProofOfPulse key={breath.phases[0].start} result={breath.result} phases={breath.phases} session={sessionId} />}
          </>
          )}
        </div>

        {/* right: verdict + telemetry */}
        <div className="order-3 space-y-8">
          {photo ? (
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.35em] text-bone/40">Photo mode</div>
              <div className="mt-1 font-serif text-[clamp(2.5rem,5vw,4rem)] italic leading-[0.95] text-bone/80">No pulse in a photo.</div>
              <p className="mt-3 max-w-sm text-sm leading-relaxed text-bone/60">
                A still image has no heartbeat to read, so photos get a different check: an AI-image detector trained on 4,803 generators, and the
                file&apos;s own metadata. Both run in this browser; the photo is never uploaded. To prove a person is alive, use Live and the Breath
                Challenge.
              </p>
            </div>
          ) : (
            <>
              <SecurityStatusBadge status={metrics.status} />
              {meeting && <Participants faces={faces} />}
              <DiagnosticMetrics m={metrics} />
            </>
          )}
        </div>
      </section>

      {/* waveform strip */}
      <section className="relative z-10 mx-auto max-w-[1400px] px-4 sm:px-8">
        <div className="flex items-center justify-between border-t border-bone/10 pt-3 font-mono text-[10px] uppercase tracking-[0.3em] text-bone/40">
          <span>Photoplethysmogram · skin colour (POS)</span>
          <span className={fake ? "text-synth" : alive ? "text-pulse" : ""}>{fake ? "flatline" : alive ? "circulating" : "—"}</span>
        </div>
        <EcgWaveformCanvas waveform={metrics.waveform} alarm={fake} height={110} />
      </section>

      {/* ticker */}
      <div className="relative z-10 mt-8 overflow-hidden border-y border-bone/10 py-3">
        <div className="marquee flex w-max gap-10 whitespace-nowrap font-mono text-[11px] uppercase tracking-[0.3em] text-bone/40">
          {[0, 1].map((k) => (
            <div key={k} className="flex gap-10" aria-hidden={k === 1}>
              {[
                "0 video bytes uploaded",
                "WASM face mesh",
                "256-frame FFT",
                "cardiac band 42–180 bpm",
                "breath challenge · proof-of-pulse",
                "blood-colour check",
                "SHA-256 audit chain",
                "ask the heart, not the face",
              ].map((t) => (
                <span key={t} className="flex items-center gap-10">
                  {t} <span className="text-pulse">✦</span>
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>

      <footer className="relative z-10 mx-auto flex max-w-[1400px] items-center gap-2 px-4 py-6 text-xs text-bone/40 sm:px-8">
        <Lock className="h-3.5 w-3.5" /> Frames never leave this tab. Only the verdict is shared with the proctor room.
      </footer>
    </main>
  );
}

function Veins({ tone }: { tone: "pulse" | "synth" }) {
  const c = tone === "synth" ? "#6ef0ff" : "#ff3b5c";
  const paths = [
    "M-50 120 C 200 60, 320 260, 560 180 S 900 40, 1500 160",
    "M-50 700 C 180 620, 420 760, 640 640 S 1100 560, 1500 700",
    "M200 -50 C 160 200, 320 380, 180 620 S 260 900, 220 1000",
    "M1250 -50 C 1300 220, 1120 420, 1260 640 S 1180 900, 1240 1000",
  ];
  return (
    <svg className="pointer-events-none absolute inset-0 h-full w-full opacity-[0.18]" viewBox="0 0 1400 900" preserveAspectRatio="xMidYMid slice" aria-hidden>
      {paths.map((d, i) => (
        <path key={i} d={d} fill="none" stroke={c} strokeWidth={1.2} className="vein" style={{ animationDelay: `${-i * 2}s` }} />
      ))}
    </svg>
  );
}

interface ReportData {
  human: number;
  fake: number;
  bpm: number | null;
  /** scored ticks where face and neck pulses agreed / where the neck could be compared */
  neckAgree: number;
  neckTotal: number;
  neckCorr: number | null;
  /** median angle (deg) between the pulse colour and haemoglobin's, and share of ticks in phase */
  bloodAngle: number | null;
  imageAi: number | null;
  bloodInPhase: number;
}

const median = (xs: number[]) => (xs.length ? [...xs].sort((a, b) => a - b)[xs.length >> 1] : null);

function VideoReport({ human, fake, bpm, neckAgree, neckTotal, neckCorr, bloodAngle, bloodInPhase, imageAi }: ReportData) {
  const total = human + fake;
  const fakeShare = total ? fake / total : 0;
  // need ~2 s of scored frames after the ~3.5 s calibration (metrics fire every 2nd frame, so 25 ≈ 2 s at 25 FPS)
  const bloodOff = videoSuspicious(bloodAngle, imageAi);
  const colourOff = bloodAngle !== null && bloodAngle > BLOOD_ANGLE_MAX;
  const verdict: LivenessStatus | "INCONCLUSIVE" | "SUSPICIOUS" =
    // the image model needs no pulse, so a strong score still counts on clips too short for a pulse reading
    total < 25 ? (imageAi !== null && imageAi >= VIDEO_AI_MIN ? "SUSPICIOUS" : "INCONCLUSIVE") : fakeShare > 0.3 ? "DEEPFAKE_DETECTED" : bloodOff ? "SUSPICIOUS" : "VERIFIED_HUMAN";
  const fakeV = verdict === "DEEPFAKE_DETECTED";
  const tone = verdict === "INCONCLUSIVE" || verdict === "SUSPICIOUS" ? "text-amber-200" : fakeV ? "text-synth" : "text-pulse";
  return (
    <div role="status" className="mt-6 rounded-3xl border border-bone/15 bg-ink/70 p-5 backdrop-blur">
      <div className="font-mono text-[10px] uppercase tracking-[0.35em] text-bone/40">Upload report</div>
      <div className={`mt-1 font-serif text-4xl italic ${tone}`}>
        {verdict === "INCONCLUSIVE" ? "Inconclusive." : verdict === "SUSPICIOUS" ? "Suspicious." : fakeV ? "Likely synthetic." : "Likely alive."}
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2 font-mono text-xs">
        {[
          ["Pulse", `${total ? Math.round((human / total) * 100) : 0}%`],
          ["No pulse", `${Math.round(fakeShare * 100)}%`],
          ["Median", bpm ? `${bpm.toFixed(0)} bpm` : "--"],
          ["Face–neck sync*", neckCorr == null ? "no neck" : neckCorr.toFixed(2)],
          ["Synced*", neckTotal ? `${Math.round((neckAgree / neckTotal) * 100)}%` : "--"],
          ["Blood colour", bloodAngle == null ? "--" : `${bloodAngle.toFixed(0)}° off`],
          ["In phase", `${Math.round(bloodInPhase * 100)}%`],
          ["Image model", imageAi == null ? "--" : `${Math.round(imageAi * 100)}% AI`],
        ].map(([k, v]) => (
          <div key={k}>
            <div className="text-[10px] uppercase tracking-[0.3em] text-bone/40">{k}</div>
            <div className="mt-1 text-bone">{v}</div>
          </div>
        ))}
      </div>
      <p className="mt-3 font-mono text-[10px] text-bone/40">
        * Experimental, not used in the verdict: face and neck pulse sync did not separate real from fake in testing.
      </p>
      <p className="mt-4 text-[11px] leading-relaxed text-bone/50">
        {verdict === "SUSPICIOUS"
          ? `${colourOff ? `The pulse-like signal is the wrong colour for blood (${bloodAngle?.toFixed(0)}° from haemoglobin's signature). ` : ""}${imageAi !== null && imageAi >= VIDEO_AI_MIN ? `The frames score ${Math.round(imageAi * 100)}% on the AI-image model (real clips tested mostly under ${Math.round(VIDEO_AI_MIN * 100)}%). ` : ""}AI-generated faces often do this. Treat as a lead for human review, not proof.`
          : verdict === "INCONCLUSIVE"
          ? "Not enough frames with a clearly visible face (needs roughly 6+ seconds of video of a steady, well-lit face)."
          : "A probabilistic signal check, not proof. Compression, low light, makeup and motion can hide a real pulse, and face-swaps laid over real actors can carry one. Use it alongside human review."}
      </p>
    </div>
  );
}

function Participants({ faces }: { faces: FaceSummary[] }) {
  return (
    <div>
      <div className="font-mono text-[10px] uppercase tracking-[0.35em] text-bone/40">In this meeting · {faces.length} visible</div>
      {faces.length === 0 && <p className="mt-2 text-sm text-bone/50">No faces in the shared window yet.</p>}
      <ul className="mt-2">
        {faces.map((f) => {
          const tone = f.status === "VERIFIED_HUMAN" ? "text-pulse" : f.status === "DEEPFAKE_DETECTED" ? "text-synth" : "text-bone/60";
          const word = f.status === "VERIFIED_HUMAN" ? "Alive" : f.status === "DEEPFAKE_DETECTED" ? "Synthetic" : "Listening";
          return (
            <li key={f.id} className="flex items-baseline justify-between border-b border-bone/10 py-2">
              <span className="font-mono text-xs text-bone/70">P{f.id}</span>
              <span className={`font-serif text-xl italic ${tone}`}>{word}.</span>
              <span className="font-mono text-xs tabular-nums text-bone/50">
                {f.bpm ? `${f.bpm.toFixed(0)} bpm` : "–– bpm"}
                {f.neckSync !== null && ` · sync ${f.neckSync.toFixed(2)}`}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
