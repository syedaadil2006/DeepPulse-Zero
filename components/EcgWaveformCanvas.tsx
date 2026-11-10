"use client";

import { useEffect, useRef } from "react";

interface Props {
  waveform: number[];
  alarm: boolean;
  height?: number;
}

/** Oscilloscope trace of the bandpassed rPPG signal; flat red noise when the pulse is missing. */
export default function EcgWaveformCanvas({ waveform, alarm, height = 140 }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const props = useRef({ waveform, alarm });
  props.current = { waveform, alarm };

  useEffect(() => {
    let raf = 0;
    const draw = () => {
      const c = ref.current;
      if (c) {
        const dpr = window.devicePixelRatio || 1;
        const w = c.clientWidth;
        const h = c.clientHeight;
        if (c.width !== w * dpr) c.width = w * dpr;
        if (c.height !== h * dpr) c.height = h * dpr;
        const ctx = c.getContext("2d")!;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);

        ctx.strokeStyle = "rgba(241,233,223,0.05)";
        ctx.lineWidth = 1;
        for (let x = 0; x < w; x += 20) {
          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x, h);
          ctx.stroke();
        }
        for (let y = 0; y < h; y += 20) {
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(w, y);
          ctx.stroke();
        }

        const { waveform: wf, alarm: bad } = props.current;
        const mid = h / 2;
        ctx.lineWidth = 2;
        ctx.shadowBlur = 10;
        ctx.beginPath();
        if (bad || wf.length < 2) {
          ctx.strokeStyle = bad ? "#6ef0ff" : "rgba(241,233,223,0.3)";
          ctx.shadowColor = ctx.strokeStyle;
          for (let x = 0; x <= w; x += 3) {
            const y = mid + (bad ? (Math.random() - 0.5) * 6 : 0);
            x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
          }
        } else {
          ctx.strokeStyle = "#ff3b5c";
          ctx.shadowColor = "#ff3b5c";
          const n = wf.length;
          for (let i = 0; i < n; i++) {
            const x = (i / (n - 1)) * w;
            const y = mid - wf[i] * (h * 0.4);
            i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
          }
        }
        ctx.stroke();
        ctx.shadowBlur = 0;
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return <canvas ref={ref} style={{ height }} className="block w-full" aria-label="rPPG pulse waveform" role="img" />;
}
