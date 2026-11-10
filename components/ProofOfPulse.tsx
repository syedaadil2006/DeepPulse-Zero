"use client";

import { useState } from "react";
import QRCode from "qrcode";
import { BadgeCheck, Copy, Loader2 } from "lucide-react";
import type { ChallengeResult, Phase } from "@/lib/breathChallenge";

/** Turns a passed Breath Challenge into a signed, scannable Proof-of-Pulse certificate. */
export default function ProofOfPulse({ result, phases, session }: { result: ChallengeResult; phases: Phase[]; session: string }) {
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");
  const [url, setUrl] = useState("");
  const [qr, setQr] = useState("");
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  if (result.verdict !== "PASS") return null;

  const issueCert = async () => {
    setState("busy");
    try {
      // phases are on the performance.now() clock; convert to wall-clock time for the certificate
      const toWall = (t: number) => Math.round(Date.now() - (performance.now() - t));
      const res = await fetch("/api/certificate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session,
          diff: result.diff,
          p: result.p,
          beats: result.points.length,
          cues: phases.length,
          startedAt: toWall(phases[0].start),
          endedAt: toWall(phases[phases.length - 1].end),
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.token) throw new Error(data.error || "The server refused to sign.");
      const link = `${location.origin}/verify?t=${data.token}`;
      setUrl(link);
      setQr(await QRCode.toDataURL(link, { margin: 1, width: 220, color: { dark: "#0a0708", light: "#f1e9df" } }));
      setState("done");
    } catch (e) {
      setError((e as Error).message);
      setState("error");
    }
  };

  const local = typeof location !== "undefined" && ["localhost", "127.0.0.1"].includes(location.hostname);

  return (
    <div className="mt-4 rounded-3xl border border-pulse/40 bg-pulse/5 p-5">
      <div className="font-mono text-[10px] uppercase tracking-[0.35em] text-pulse">Proof-of-Pulse</div>
      {state !== "done" ? (
        <>
          <p className="mt-2 text-sm text-bone/70">Seal this result in a signed, time-stamped certificate anyone can verify by scanning a QR code.</p>
          <button
            onClick={issueCert}
            disabled={state === "busy"}
            className="mt-4 flex items-center gap-2 rounded-full bg-pulse px-5 py-2.5 font-mono text-xs uppercase tracking-[0.2em] text-ink transition hover:brightness-110 disabled:opacity-60"
          >
            {state === "busy" ? <Loader2 className="h-4 w-4 animate-spin" /> : <BadgeCheck className="h-4 w-4" />} Issue certificate
          </button>
          {state === "error" && <p className="mt-2 text-xs text-synth">{error}</p>}
        </>
      ) : (
        <div className="mt-3 flex flex-col items-center gap-4 sm:flex-row sm:items-start">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qr} alt="QR code linking to the certificate verification page" className="h-40 w-40 shrink-0 rounded-xl" />
          <div className="min-w-0">
            <div className="font-serif text-3xl italic text-pulse">Certified alive.</div>
            <p className="mt-1 text-xs text-bone/60">Signed by this DeepPulse server. Any edit to the certificate breaks the signature.</p>
            <div className="mt-3 flex gap-2">
              <a href={url} target="_blank" rel="noreferrer" className="rounded-full border border-bone/30 px-4 py-2 font-mono text-[11px] uppercase tracking-[0.2em] hover:bg-bone hover:text-ink">
                Open verifier
              </a>
              <button
                onClick={() => navigator.clipboard.writeText(url).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }, () => window.prompt("Copy this link:", url))}
                className="flex items-center gap-1.5 rounded-full border border-bone/30 px-4 py-2 font-mono text-[11px] uppercase tracking-[0.2em] hover:bg-bone hover:text-ink"
              >
                <Copy className="h-3.5 w-3.5" /> {copied ? "Copied" : "Copy link"}
              </button>
            </div>
            {local && (
              <p className="mt-3 text-[11px] leading-relaxed text-amber-200/80">
                This link points at localhost, which a phone can&apos;t reach. To scan it on a phone, run the app with <code>npm run dev -- -H 0.0.0.0</code> and open it
                via your laptop&apos;s network address (e.g. http://192.168.x.x:3000).
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
