"use client";

import { useEffect, useRef } from "react";
import type { LivenessStatus } from "@/types";

interface Props {
  waveform: number[];
  bpm: number | null;
  status: LivenessStatus;
  /** fraction of the canvas radius taken by the lens it surrounds */
  lens?: number;
}

const BLOOD = "255,59,92";
const SILICON = "110,240,255";
const BONE = "241,233,223";

/** Watch-bezel halo around the scanner lens: the rPPG waveform wrapped in polar form plus a comet sweeping once per heartbeat. */
export default function PulseHalo({ waveform, bpm, status, lens = 0.78 }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const props = useRef({ waveform, bpm, status });
  props.current = { waveform, bpm, status };

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    const t0 = performance.now();

    const draw = (now: number) => {
      const c = ref.current;
      if (c) {
        const dpr = window.devicePixelRatio || 1;
        const px = c.clientWidth;
        if (c.width !== px * dpr) c.width = c.height = px * dpr;
        const ctx = c.getContext("2d")!;
        const size = 560; // draw in a fixed virtual space, scaled to the real width
        ctx.setTransform((dpr * px) / size, 0, 0, (dpr * px) / size, 0, 0);
        ctx.clearRect(0, 0, size, size);

        const { waveform: wf, bpm: rate, status: st } = props.current;
        const cx = size / 2;
        const R = (size / 2) * lens;
        const t = reduce ? 0 : (now - t0) / 1000;
        const alive = st === "VERIFIED_HUMAN";
        const fake = st === "DEEPFAKE_DETECTED";
        const rgb = fake ? SILICON : alive ? BLOOD : BONE;

        // beat envelope: sharp lub, softer dub
        const period = 60 / (rate && alive ? rate : 60);
        const ph = (t % period) / period;
        const env = alive ? Math.exp(-ph * 14) + 0.5 * Math.exp(-Math.max(0, ph - 0.28) * 16) * (ph > 0.28 ? 1 : 0) : 0;

        // bezel ticks with a comet sweeping once per beat
        const ticks = 120;
        const head = alive ? ph * Math.PI * 2 : t * 0.4;
        for (let i = 0; i < ticks; i++) {
          const a = (i / ticks) * Math.PI * 2 - Math.PI / 2;
          let d = (((a + Math.PI / 2 - head) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
          d = Math.PI * 2 - d; // distance behind the comet head
          const trail = Math.max(0, 1 - d / 1.6);
          const major = i % 10 === 0;
          const r0 = R + 14;
          const r1 = r0 + (major ? 14 : 7);
          const jitter = fake ? (Math.random() - 0.5) * 6 : 0;
          ctx.strokeStyle = `rgba(${rgb},${0.12 + trail * 0.85})`;
          ctx.lineWidth = major ? 1.6 : 1;
          ctx.beginPath();
          ctx.moveTo(cx + Math.cos(a) * (r0 + jitter), cx + Math.sin(a) * (r0 + jitter));
          ctx.lineTo(cx + Math.cos(a) * (r1 + jitter), cx + Math.sin(a) * (r1 + jitter));
          ctx.stroke();
        }

        // polar waveform
        const rw = R + 46;
        ctx.lineWidth = 1.5;
        ctx.shadowBlur = 16;
        ctx.shadowColor = `rgba(${rgb},0.9)`;
        ctx.strokeStyle = `rgba(${rgb},${alive ? 0.95 : 0.6})`;
        ctx.beginPath();
        const n = fake || wf.length < 8 ? 180 : wf.length;
        for (let i = 0; i <= n; i++) {
          const k = i % n;
          const a = (k / n) * Math.PI * 2 - Math.PI / 2 + (alive ? 0 : t * 0.15);
          const v = fake ? (Math.random() - 0.5) * 0.5 : wf.length >= 8 ? wf[k] : Math.sin(k * 0.35 + t * 2) * 0.06;
          const r = rw + v * 16;
          const x = cx + Math.cos(a) * r;
          const y = cx + Math.sin(a) * r;
          i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.shadowBlur = 0;

        // heartbeat shockwave hugging the lens
        if (alive) {
          ctx.strokeStyle = `rgba(${BLOOD},${0.7 * env})`;
          ctx.lineWidth = 2 + env * 6;
          ctx.beginPath();
          ctx.arc(cx, cx, R + 4 + env * 6, 0, Math.PI * 2);
          ctx.stroke();
        }

        // outer hairline
        ctx.strokeStyle = `rgba(${BONE},0.08)`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(cx, cx, R + 70, 0, Math.PI * 2);
        ctx.stroke();
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [lens]);

  return <canvas ref={ref} className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden />;
}
