"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { aiProbability, scanMetadata, verdictFor, type MetadataFindings, type PhotoVerdict } from "@/lib/photoCheck";

type State =
  | { kind: "loading"; step: string }
  | { kind: "done"; meta: MetadataFindings; p: number | null; verdict: PhotoVerdict; modelError?: string }
  | { kind: "error"; message: string };

const WORDS: Record<PhotoVerdict, { word: string; tone: string; note: string }> = {
  DECLARED_AI: { word: "Declared AI-generated.", tone: "text-synth", note: "The file itself says an AI tool made or edited it." },
  LIKELY_AI: { word: "Likely AI-generated.", tone: "text-synth", note: "The image model sees the fingerprints image generators leave behind." },
  NO_AI_SIGNS: {
    word: "No AI signs found.",
    tone: "text-bone",
    note: "Nothing in the file or the pixels points to an AI generator. That is not proof it is real: in testing the model missed most AI video frames and face-swaps.",
  },
  UNCERTAIN: { word: "Uncertain.", tone: "text-amber-200", note: "The signals are mixed. Treat this photo as unverified." },
};

/** Analyses an uploaded photo in this browser: file metadata plus an AI-image model. */
export default function PhotoCheck({ file }: { file: File }) {
  const [url, setUrl] = useState("");
  const [state, setState] = useState<State>({ kind: "loading", step: "Reading the file" });

  useEffect(() => {
    let cancelled = false;
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    setState({ kind: "loading", step: "Reading the file" });
    (async () => {
      try {
        const meta = scanMetadata(new Uint8Array(await file.arrayBuffer()));
        const img = new Image();
        img.src = objectUrl;
        await img.decode().catch(() => {
          throw new Error("This image format can't be opened by your browser. Try a JPG, PNG or WebP.");
        });
        if (cancelled) return;
        setState({ kind: "loading", step: "Running the AI-image model (first time downloads ~16 MB)" });
        let p: number | null = null;
        let modelError: string | undefined;
        try {
          p = await aiProbability(img);
        } catch (e) {
          modelError = (e as Error).message || "The image model could not run.";
        }
        if (!cancelled) setState({ kind: "done", meta, p, verdict: verdictFor(meta, p), modelError });
      } catch (e) {
        if (!cancelled) setState({ kind: "error", message: (e as Error).message });
      }
    })();
    return () => {
      cancelled = true;
      URL.revokeObjectURL(objectUrl);
    };
  }, [file]);

  return (
    <div>
      <div className="relative mx-auto aspect-square w-[70%] overflow-hidden rounded-full bg-black ring-1 ring-bone/10 shadow-[0_0_120px_rgba(110,240,255,0.15)]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {url && <img src={url} alt="Uploaded photo being checked" className="absolute inset-0 h-full w-full object-cover" />}
        <div className="pointer-events-none absolute inset-0 rounded-full shadow-[inset_0_0_80px_30px_rgba(10,7,8,0.85)]" />
        {state.kind === "loading" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-ink/60 px-10 text-center">
            <Loader2 className="h-7 w-7 animate-spin text-pulse" />
            <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-bone/70">{state.step}</p>
          </div>
        )}
      </div>

      <div role="status" className="mt-6 rounded-3xl border border-bone/15 bg-ink/70 p-5 backdrop-blur">
        <div className="font-mono text-[10px] uppercase tracking-[0.35em] text-bone/40">Photo report</div>
        {state.kind === "error" && <p className="mt-2 text-sm text-synth">{state.message}</p>}
        {state.kind === "loading" && <p className="mt-2 text-sm text-bone/50">Checking…</p>}
        {state.kind === "done" && (
          <>
            <div className={`mt-1 font-serif text-4xl italic ${WORDS[state.verdict].tone}`}>{WORDS[state.verdict].word}</div>
            <p className="mt-1 text-sm text-bone/60">{WORDS[state.verdict].note}</p>
            <div className="mt-4 grid grid-cols-3 gap-2 font-mono text-xs">
              {[
                ["AI score", state.p === null ? "--" : `${Math.round(state.p * 100)}%`],
                ["Metadata", state.meta.ai.length ? state.meta.ai.join(", ") : state.meta.c2pa ? "Content Credentials" : "nothing declared"],
                ["Camera", state.meta.camera ?? "not named"],
              ].map(([k, v]) => (
                <div key={k}>
                  <div className="text-[10px] uppercase tracking-[0.3em] text-bone/40">{k}</div>
                  <div className="mt-1 break-words text-bone">{v}</div>
                </div>
              ))}
            </div>
            {state.modelError && <p className="mt-3 text-xs text-amber-200">Image model unavailable: {state.modelError}</p>}
            <p className="mt-4 text-[11px] leading-relaxed text-bone/50">
              A photo has no heartbeat, so this uses a different test: an AI-image detector (Community Forensics, CVPR 2025) run in this browser,
              plus what the file says about itself. It cannot tell a real photo of the wrong person, misses some new generators, and resizing,
              screenshots or heavy compression weaken it. Metadata is easily removed, so its absence proves nothing.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
