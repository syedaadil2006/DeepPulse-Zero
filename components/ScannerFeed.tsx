"use client";

import { useEffect, useRef, useState } from "react";
import { aiProbability } from "@/lib/photoCheck";
import { CameraOff, Loader2 } from "lucide-react";
import type { FaceSummary, Landmark, Metrics } from "@/types";
import { createFaceMesh, getNeckRoi, getRois, landmarkMotion, tessellation, type FaceMeshInstance } from "@/lib/mediapipe";
import { compareFaceNeck, meanRgb, RppgEngine } from "@/lib/rppgEngine";
import type { Rgb } from "@/lib/fft";

const MAX_MEETING_FACES = 4;
const DROP_AFTER_FRAMES = 30; // forget a participant after ~1 s out of view
const STALL_MS = 30_000;
const STALL_MESSAGE =
  "The face model stopped responding, usually a graphics (WebGL) problem. Press Retry, turn on hardware acceleration, or try another browser.";

interface Props {
  attackMode: boolean;
  onMetrics: (m: Metrics) => void;
  /** analyse an uploaded video instead of the webcam */
  file?: File | null;
  /** analyse a shared screen/window/tab (Zoom, Meet, Teams…) instead of the webcam */
  screen?: boolean;
  /** every visible face, for multi-person sources */
  onFaces?: (faces: FaceSummary[]) => void;
  /** upload finished; imageAi = mean AI score of 8 sampled frames (null if the model could not run) */
  onEnded?: (imageAi: number | null) => void;
  /** restart the scanner after an error (defaults to reloading the page) */
  onRetry?: () => void;
}

/** One tracked person: their own pulse buffers, so participants never mix. */
interface Track {
  id: number;
  engine: RppgEngine;
  neck: RppgEngine;
  prevLm: Landmark[] | null;
  cx: number;
  cy: number;
  size: number;
  missed: number;
  frozen: { face: Rgb; neck: Rgb | null } | null;
}

const STATUS_COLOR: Record<string, string> = {
  VERIFIED_HUMAN: "#ff3b5c",
  DEEPFAKE_DETECTED: "#6ef0ff",
  CALIBRATING: "#f1e9df",
  NO_FACE: "#f1e9df",
  IDLE: "#f1e9df",
};

export default function ScannerFeed({ attackMode, onMetrics, file = null, screen = false, onFaces, onEnded, onRetry }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const attackRef = useRef(attackMode);
  const tracksRef = useRef<Track[]>([]);
  const onMetricsRef = useRef(onMetrics);
  const onFacesRef = useRef(onFaces);
  const onEndedRef = useRef(onEnded);
  onMetricsRef.current = onMetrics;
  onFacesRef.current = onFaces;
  onEndedRef.current = onEnded;
  const [phase, setPhase] = useState<"init" | "model" | "live" | "error">("init");
  const [error, setError] = useState("");
  const [progress, setProgress] = useState(0); // upload mode: percent of the clip analysed
  const mirrored = !file && !screen; // only the selfie camera is shown mirrored

  useEffect(() => {
    attackRef.current = attackMode;
    // flush frozen samples so the real pulse re-calibrates cleanly
    if (!attackMode) for (const tr of tracksRef.current) tr.engine.reset(), tr.neck.reset();
  }, [attackMode]);

  useEffect(() => {
    let stopped = false;
    let raf = 0;
    // rAF stops in a hidden tab, which is where this tab sits during a meeting; a worker timer keeps ticking
    // shortcut: browsers may still slow hidden-tab video and WebGL, so keep this tab visible for best results
    const ticker = screen ? new Worker(URL.createObjectURL(new Blob(["onmessage=()=>setTimeout(()=>postMessage(0),33)"]))) : null;
    if (ticker) ticker.onmessage = () => loop();
    let stream: MediaStream | null = null;
    let fm: FaceMeshInstance | null = null;
    const off = document.createElement("canvas");
    const offCtx = off.getContext("2d", { willReadFrequently: true })!;
    const noFace = new RppgEngine();
    let nextId = 1;
    let sendStart = 0;
    let lastFrame = 0;
    let fps = 0;
    let frameNo = 0;
    tracksRef.current = [];
    // meeting tiles are small inside a large shared screen, so sample at a higher resolution
    const sampleW = screen ? 960 : 320;

    const onResults = (res: { multiFaceLandmarks?: Landmark[][] }) => {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas || stopped) return;
      const now = performance.now();
      // uploads use media time so the sample rate matches the recording, not our processing speed
      const t = file ? video.currentTime * 1000 : now;
      const w = video.videoWidth;
      const h = video.videoHeight;
      if (canvas.width !== w) canvas.width = w;
      if (canvas.height !== h) canvas.height = h;
      const ctx = canvas.getContext("2d")!;
      ctx.clearRect(0, 0, w, h);
      const attack = attackRef.current;
      const faces = res.multiFaceLandmarks ?? [];
      const tracks = tracksRef.current;

      // match each face to the nearest existing track (nose tip, within half a face height)
      for (const tr of tracks) tr.missed++;
      const matched: { tr: Track; lm: Landmark[] }[] = [];
      for (const lm of faces) {
        const cx = lm[1].x;
        const cy = lm[1].y;
        const size = Math.abs(lm[152].y - lm[10].y);
        let best: Track | null = null;
        let bestD = size * 0.5;
        for (const tr of tracks) {
          const d = Math.hypot(tr.cx - cx, tr.cy - cy);
          if (tr.missed > 0 && d < bestD) (best = tr), (bestD = d);
        }
        if (!best) {
          best = { id: nextId++, engine: new RppgEngine(), neck: new RppgEngine(), prevLm: null, cx, cy, size, missed: 1, frozen: null };
          tracks.push(best);
        }
        Object.assign(best, { cx, cy, size, missed: 0 });
        matched.push({ tr: best, lm });
      }
      tracksRef.current = tracks.filter((tr) => tr.missed <= DROP_AFTER_FRAMES);
      for (const tr of tracks) if (tr.missed > 0) tr.neck.reset(); // neck buffer must stay frame-aligned

      let img: ImageData | null = null;
      let scale = 1;
      if (matched.length) {
        scale = Math.min(1, sampleW / w);
        off.width = Math.round(w * scale);
        off.height = Math.round(h * scale);
        offCtx.drawImage(video, 0, 0, off.width, off.height);
        img = offCtx.getImageData(0, 0, off.width, off.height);
      }
      const sc = <R extends { x: number; y: number; w: number; h: number }>(r: R): R => ({ ...r, x: r.x * scale, y: r.y * scale, w: r.w * scale, h: r.h * scale });

      const summaries: FaceSummary[] = [];
      const evs = new Map<Track, ReturnType<RppgEngine["evaluate"]>>();
      let primary: { tr: Track; motion: number } | null = null;
      for (const { tr, lm } of matched) {
        // wireframe mesh
        ctx.strokeStyle = attack ? "rgba(110,240,255,0.35)" : "rgba(255,59,92,0.35)";
        ctx.lineWidth = screen ? 0.4 : 0.6;
        ctx.beginPath();
        for (const [a, b] of tessellation()) {
          ctx.moveTo(lm[a].x * w, lm[a].y * h);
          ctx.lineTo(lm[b].x * w, lm[b].y * h);
        }
        ctx.stroke();

        // ROI boxes
        const rois = getRois(lm, w, h);
        const neckRoi = getNeckRoi(lm, w, h);
        ctx.save();
        ctx.shadowBlur = 12;
        ctx.shadowColor = ctx.strokeStyle = attack ? "#6ef0ff" : "#ff3b5c";
        ctx.lineWidth = 2;
        for (const r of rois) ctx.strokeRect(r.x, r.y, r.w, r.h);
        if (neckRoi) {
          ctx.setLineDash([6, 6]);
          ctx.strokeRect(neckRoi.x, neckRoi.y, neckRoi.w, neckRoi.h);
        }
        ctx.restore();

        // RGB sampling (POS needs all three channels)
        let faceRgb = meanRgb(img!.data, off.width, off.height, rois.map(sc));
        let neckRgb = neckRoi ? meanRgb(img!.data, off.width, off.height, [sc(neckRoi)]) : null;

        // attack simulation: replace the live skin signal with a static injected frame (what a synthetic feed looks like)
        if (attack) {
          tr.frozen ??= { face: faceRgb, neck: neckRgb };
          faceRgb = tr.frozen.face;
          neckRgb = tr.frozen.neck ?? neckRgb;
        } else tr.frozen = null;

        const motion = landmarkMotion(tr.prevLm, lm);
        tr.prevLm = lm;
        tr.engine.push(faceRgb, t);
        if (neckRgb) tr.neck.push(neckRgb, t);
        else tr.neck.reset();

        if (!primary || tr.size > primary.tr.size) primary = { tr, motion };

        if (screen) {
          const ev = tr.engine.evaluate(true, t);
          evs.set(tr, ev);
          const neck = compareFaceNeck(tr.engine, tr.neck);
          summaries.push({ id: tr.id, status: ev.status, bpm: ev.bpm, pulseIndex: ev.pulseIndex, neckSync: neck ? neck.corr : null });
          // name tag above each participant (screen capture is not mirrored, so text reads correctly)
          const x = Math.min(...rois.map((r) => r.x));
          const y = Math.max(14, lm[10].y * h - 10);
          ctx.font = `${Math.max(12, Math.round(tr.size * h * 0.09))}px ui-monospace, monospace`;
          ctx.fillStyle = STATUS_COLOR[ev.status];
          const word = ev.status === "VERIFIED_HUMAN" ? "ALIVE" : ev.status === "DEEPFAKE_DETECTED" ? "SYNTHETIC" : "LISTENING";
          ctx.fillText(`P${tr.id} · ${word}${ev.bpm ? ` · ${ev.bpm.toFixed(0)}` : ""}`, x, y);
        }
      }

      const ev = primary ? (evs.get(primary.tr) ?? primary.tr.engine.evaluate(true, t)) : noFace.evaluate(false, t);
      if (lastFrame) fps = fps ? fps * 0.9 + (1000 / (now - lastFrame)) * 0.1 : 1000 / (now - lastFrame);
      lastFrame = now;

      if (++frameNo % 2 === 0) {
        const neck = primary ? compareFaceNeck(primary.tr.engine, primary.tr.neck) : null;
        onMetricsRef.current({ ...ev, neck, fps, latencyMs: performance.now() - sendStart, motion: primary?.motion ?? 0 });
        if (screen) onFacesRef.current?.(summaries.sort((a, b) => a.id - b.id));
      }
    };

    // A crashed face model (e.g. a WebGL failure inside MediaPipe) never settles send(); give up
    // with an error instead of sitting on "Standby" forever. The first send also downloads the model.
    const send = (video: HTMLVideoElement) => {
      sendStart = performance.now();
      let timer = 0;
      return Promise.race([
        fm!.send({ image: video }).catch(() => {}), // a single dropped frame is fine
        new Promise<never>((_, reject) => (timer = window.setTimeout(() => reject(new Error(STALL_MESSAGE)), STALL_MS))),
      ]).finally(() => clearTimeout(timer));
    };

    const loop = async () => {
      if (stopped || !fm) return;
      const video = videoRef.current;
      if (video && video.readyState >= 2) {
        try {
          await send(video);
        } catch (e) {
          if (stopped) return;
          setError((e as Error).message);
          return setPhase("error");
        }
      }
      if (stopped) return;
      if (ticker && document.hidden) ticker.postMessage(0);
      else raf = requestAnimationFrame(loop);
    };

    (async () => {
      try {
        setPhase("init");
        if (file) {
          const video = videoRef.current!;
          video.srcObject = null;
          video.src = URL.createObjectURL(file);
          await new Promise((r, j) => {
            video.onloadeddata = r;
            video.onerror = () => j(new Error("This video format can't be decoded by your browser. Try an MP4 (H.264) or WebM file."));
          });
          setPhase("model");
          fm = await createFaceMesh(1, true); // recorded video: the engine the blood-colour check was tuned on
          if (stopped) return void fm.close().catch(() => {});
          fm.onResults(onResults);
          setPhase("live");
          // step frame-by-frame at a fixed 30 FPS of media time so slow devices never skip frames
          const step = 1 / 30;
          const ai: number[] = [];
          let nextPick = 0;
          let aiDead = false;
          // recorded WebM often reports an infinite length until you seek past the end
          if (!Number.isFinite(video.duration)) {
            video.currentTime = 1e9;
            await new Promise((r) => (video.onseeked = r));
          }
          if (!Number.isFinite(video.duration)) throw new Error("This video has no readable length. Re-save it as MP4 and try again.");
          for (let ts = 0.001; ts < video.duration && !stopped; ts += step) {
            video.currentTime = ts;
            await new Promise((r) => (video.onseeked = r));
            await send(video);
            // 8 evenly spaced frames also go through the photo model (it runs locally, like the face mesh)
            if (!aiDead && nextPick < 8 && ts >= (video.duration * (nextPick + 0.5)) / 8) {
              nextPick++;
              const c = document.createElement("canvas");
              c.width = video.videoWidth;
              c.height = video.videoHeight;
              c.getContext("2d")!.drawImage(video, 0, 0);
              await aiProbability(c).then((p) => ai.push(p), () => (aiDead = true));
            }
            setProgress(Math.round((ts / video.duration) * 100));
          }
          setProgress(100);
          if (!stopped) onEndedRef.current?.(ai.length ? ai.reduce((a, b) => a + b, 0) / ai.length : null);
          return;
        }
        if (screen) {
          if (!navigator.mediaDevices?.getDisplayMedia) throw new Error("This browser can't share a screen. Use desktop Chrome, Edge or Firefox.");
          stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 30 } }, audio: false });
          stream.getVideoTracks()[0].onended = () => {
            if (stopped) return;
            setError("Screen sharing stopped. Choose Meeting again to pick a window.");
            setPhase("error");
          };
        } else {
          if (!navigator.mediaDevices?.getUserMedia) throw new Error("This browser does not expose a camera API (use HTTPS or localhost).");
          stream = await navigator.mediaDevices.getUserMedia({
            video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 }, facingMode: "user" },
            audio: false,
          });
        }
        if (stopped) return stream.getTracks().forEach((t) => t.stop());
        const video = videoRef.current!;
        video.srcObject = stream;
        await video.play();
        setPhase("model");
        fm = await createFaceMesh(screen ? MAX_MEETING_FACES : 1);
        if (stopped) return void fm.close().catch(() => {});
        fm.onResults(onResults);
        setPhase("live");
        loop();
      } catch (e) {
        if (stopped) return;
        const err = e as DOMException;
        const msg =
          err.name === "NotAllowedError"
            ? screen
              ? "Screen sharing was cancelled. Choose Meeting again and pick your Zoom, Meet or Teams window."
              : "Camera permission was denied. Allow camera access in your browser's site settings and reload."
            : err.name === "NotFoundError"
              ? "No camera was found on this device."
              : err.name === "NotReadableError"
                ? "The camera is in use by another application."
                : err.message || "Could not start the scanner.";
        setError(msg);
        setPhase("error");
      }
    })();

    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      ticker?.terminate();
      stream?.getTracks().forEach((t) => t.stop());
      const v = videoRef.current;
      if (v) {
        v.onended = null;
        if (v.src) {
          v.pause();
          URL.revokeObjectURL(v.src);
          v.removeAttribute("src");
        }
        v.srcObject = null;
      }
      fm?.close().catch(() => {});
      tracksRef.current = [];
    };
  }, [file, screen]);

  const fit = screen ? "object-contain" : "object-cover"; // keep the whole meeting gallery visible
  return (
    <div
      className={`relative aspect-square w-full overflow-hidden rounded-full bg-black ring-1 transition-shadow duration-700 ${
        attackMode ? "ring-synth/60 shadow-[0_0_120px_rgba(110,240,255,0.25)]" : "ring-bone/10 shadow-[0_0_120px_rgba(255,59,92,0.18)]"
      }`}
    >
      <video ref={videoRef} playsInline muted className={`absolute inset-0 h-full w-full ${fit} ${mirrored ? "-scale-x-100" : ""}`} />
      <canvas ref={canvasRef} className={`absolute inset-0 h-full w-full ${fit} ${mirrored ? "-scale-x-100" : ""}`} aria-hidden />
      <div className="scanline pointer-events-none absolute inset-0" />
      {/* lens vignette */}
      <div className="pointer-events-none absolute inset-0 rounded-full shadow-[inset_0_0_80px_30px_rgba(10,7,8,0.9)]" />
      {attackMode && <div className="pointer-events-none absolute inset-0 bg-synth/10 mix-blend-color" />}

      {file && phase === "live" && progress < 100 && (
        <div role="progressbar" aria-label="Video analysed" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100} className="absolute inset-x-0 bottom-[14%] text-center font-mono text-[11px] uppercase tracking-[0.3em] text-bone/80">
          Analysing · {progress}%
        </div>
      )}

      {phase !== "live" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-ink/90 px-14 text-center">
          {phase === "error" ? (
            <>
              <CameraOff className="h-9 w-9 text-synth" />
              <p className="max-w-xs text-sm text-bone/70">{error}</p>
              <button onClick={onRetry ?? (() => location.reload())} className="rounded-full border border-bone/30 px-5 py-2 font-mono text-xs uppercase tracking-widest hover:bg-bone hover:text-ink">
                Retry
              </button>
            </>
          ) : (
            <>
              <Loader2 className="h-7 w-7 animate-spin text-pulse" />
              <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-bone/50">
                {phase === "init" ? (file ? "Loading video" : screen ? "Pick the meeting window" : "Waking the camera") : "Loading face mesh"}
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
