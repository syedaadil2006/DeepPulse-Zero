"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ShieldAlert, ShieldCheck, Loader2 } from "lucide-react";
import type { Certificate } from "@/lib/certificate";

type State = { kind: "loading" } | { kind: "valid"; cert: Certificate } | { kind: "invalid" };

export default function VerifyPage() {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    const t = new URLSearchParams(location.search).get("t") ?? "";
    fetch(`/api/certificate?t=${encodeURIComponent(t)}`)
      .then((r) => r.json())
      .then((d) => setState(d.valid ? { kind: "valid", cert: d.cert } : { kind: "invalid" }))
      .catch(() => setState({ kind: "invalid" }));
  }, []);

  const when = (ms: number) => new Date(ms).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "medium" });

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center px-4 py-10 sm:px-8">
      <div className="flex items-baseline gap-2">
        <span className="font-serif text-3xl italic">DeepPulse</span>
        <span className="font-mono text-xs tracking-[0.3em] text-pulse">/VERIFY</span>
      </div>

      <div role="status" aria-live="polite" className="mt-10">
        {state.kind === "loading" && (
          <div className="flex items-center gap-3 text-bone/60">
            <Loader2 className="h-5 w-5 animate-spin" /> Checking signature…
          </div>
        )}

        {state.kind === "invalid" && (
          <>
            <ShieldAlert className="h-10 w-10 text-synth" />
            <h1 className="mt-4 font-serif text-[clamp(3rem,10vw,5rem)] italic leading-none text-synth">Not valid.</h1>
            <p className="mt-4 text-sm leading-relaxed text-bone/60">
              This certificate was not issued by this DeepPulse server, or it has been altered. Do not accept it as proof of a live person.
            </p>
          </>
        )}

        {state.kind === "valid" && (
          <>
            <ShieldCheck className="h-10 w-10 text-pulse" />
            <h1 className="mt-4 font-serif text-[clamp(3rem,10vw,5rem)] italic leading-none text-pulse">Verified.</h1>
            <p className="mt-4 text-sm leading-relaxed text-bone/70">
              A live heart answered a randomized breathing challenge. This certificate is signed by the DeepPulse server and has not been altered.
            </p>
            <dl className="mt-8">
              {[
                ["Session", state.cert.session],
                ["Challenge", `${when(state.cert.startedAt)} → ${new Date(state.cert.endedAt).toLocaleTimeString()}`],
                ["Heart response", `+${state.cert.diff.toFixed(1)} bpm on inhale`],
                ["Chance it was luck", `p = ${state.cert.p.toFixed(3)}`],
                ["Beats · cues", `${state.cert.beats} beats · ${state.cert.cues} random cues`],
                ["Issued", when(state.cert.issuedAt)],
                ["Certificate ID", state.cert.id],
              ].map(([k, v]) => (
                <div key={k} className="flex items-baseline justify-between gap-4 border-b border-bone/10 py-2.5">
                  <dt className="font-mono text-[10px] uppercase tracking-[0.3em] text-bone/40">{k}</dt>
                  <dd className="text-right font-mono text-sm text-bone">{v}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-6 text-[11px] leading-relaxed text-bone/40">
              Proves the challenge passed in a DeepPulse session at that time. It cannot prove which person sat the challenge, or that the device running it
              was not tampered with.
            </p>
          </>
        )}
      </div>

      <Link href="/" className="mt-10 font-mono text-[11px] uppercase tracking-[0.25em] text-bone/40 hover:text-pulse">
        ← DeepPulse scanner
      </Link>
    </main>
  );
}
