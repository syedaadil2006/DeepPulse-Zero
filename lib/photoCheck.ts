/**
 * Photo check: a photo has no heartbeat, so it gets two different tests.
 * 1. File metadata: AI tools often declare themselves (C2PA, IPTC "trainedAlgorithmicMedia", generator names).
 * 2. Community Forensics ViT (Park & Owens, CVPR 2025; trained on 4,803 generators), run in the browser.
 */

// Corrected July-2026 weights; older copies (incl. onnx-community) carry wrong weights.
export const MODEL_URL = "https://huggingface.co/buildborderless/CommunityForensics-DeepfakeDet-ViT/resolve/main/onnx/model_q4.onnx"; // 4-bit MatMul only: int8 uses ConvInteger, which onnxruntime-web lacks
const ORT_URL = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/ort.min.js";
export const CROP = 384;
const SHORT_EDGE = 440;
const MEAN = [0.48145466, 0.4578275, 0.40821073];
const STD = [0.26862954, 0.26130258, 0.27577711];
// shortcut: tuned on 395 OpenFake photos (AUC 0.91) and 37 video frames (EVALUATION.md). AI images often score
// far below 0.65 but above real photos; a lower AI cut-off flagged 14/16 real webcam frames, so 0.01-0.65 is "uncertain".
export const AI_MIN = 0.65; // 0 of 205 real photos flagged
export const NO_SIGNS_MAX = 0.01; // 2% of real photos, 59% of AI images score above this

export interface MetadataFindings {
  /** AI declarations found in the file (generator names, C2PA AI assertions, IPTC digital source type) */
  ai: string[];
  /** C2PA / Content Credentials manifest present */
  c2pa: boolean;
  /** camera maker named in EXIF, if any */
  camera: string | null;
}

export type PhotoVerdict = "DECLARED_AI" | "LIKELY_AI" | "NO_AI_SIGNS" | "UNCERTAIN";

const AI_MARKERS: [RegExp, string][] = [
  [/trainedAlgorithmicMedia/i, "IPTC: made by generative AI"],
  [/c2pa\.ai_generat|c2pa\.ai_inference|"ai_generated"/i, "C2PA: AI-generated assertion"],
  [/Midjourney/i, "Midjourney"],
  [/DALL(?:·|Â·|[.\-\s])?E/i, "DALL·E"], // "Â·" is UTF-8 "·" seen through latin1
  [/Stable[\s_-]?Diffusion|ComfyUI|AUTOMATIC1111|Steps: \d+, Sampler:/i, "Stable Diffusion"],
  [/Adobe Firefly/i, "Adobe Firefly"],
  [/Imagen|SynthID/i, "Google Imagen"],
  [/ChatGPT|OpenAI/i, "OpenAI"],
  [/\bFLUX\.?1\b|black-forest-labs/i, "FLUX"],
  [/Ideogram|Leonardo\.Ai|NovelAI|Runway/i, "AI image service"],
];
const CAMERAS = /\b(Canon|NIKON|SONY|Apple|samsung|Google|FUJIFILM|OLYMPUS|Panasonic|LEICA|HUAWEI|Xiaomi|OnePlus|motorola|DJI|GoPro|RICOH|PENTAX|HONOR|vivo|OPPO)\b/;

/** Scan raw file bytes for metadata text (EXIF, XMP, PNG text chunks, C2PA/JUMBF labels). */
export function scanMetadata(bytes: Uint8Array): MetadataFindings {
  // latin1 keeps every byte, so ASCII markers inside binary metadata stay searchable
  const text = new TextDecoder("latin1").decode(bytes.subarray(0, 4_000_000));
  const ai = [...new Set(AI_MARKERS.filter(([re]) => re.test(text)).map(([, name]) => name))];
  const c2pa = /c2pa/i.test(text) && /jumb|jumd/i.test(text);
  const camera = text.match(CAMERAS)?.[1] ?? null;
  return { ai, c2pa, camera };
}

/** RGBA pixels (CROP x CROP) -> CLIP-normalized CHW float tensor data. */
export function toTensorData(rgba: Uint8ClampedArray, size = CROP): Float32Array {
  const plane = size * size;
  const out = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i++)
    for (let c = 0; c < 3; c++) out[c * plane + i] = (rgba[i * 4 + c] / 255 - MEAN[c]) / STD[c];
  return out;
}

/** Shortest edge -> 440, centre crop 384 (the model's documented preprocessing), as source-image coordinates. */
export function cropBox(w: number, h: number) {
  const scale = SHORT_EDGE / Math.min(w, h);
  const side = CROP / scale; // the 384 px crop measured in source pixels
  return { sx: (w - side) / 2, sy: (h - side) / 2, side };
}

export const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

export function verdictFor(meta: MetadataFindings, aiProbability: number | null): PhotoVerdict {
  if (meta.ai.length) return "DECLARED_AI";
  if (aiProbability === null) return "UNCERTAIN";
  return aiProbability >= AI_MIN ? "LIKELY_AI" : aiProbability <= NO_SIGNS_MAX ? "NO_AI_SIGNS" : "UNCERTAIN";
}

// ---- browser-only below ----

interface Ort {
  InferenceSession: { create(url: string, o?: object): Promise<OrtSession> };
  Tensor: new (type: "float32", data: Float32Array, dims: number[]) => unknown;
  env: { wasm: { wasmPaths?: string } };
}
interface OrtSession {
  inputNames: string[];
  outputNames: string[];
  run(feeds: Record<string, unknown>): Promise<Record<string, { data: Float32Array }>>;
}

let session: Promise<OrtSession> | null = null;

function loadSession(): Promise<OrtSession> {
  session ??= new Promise<Ort>((resolve, reject) => {
    const w = window as unknown as { ort?: Ort };
    if (w.ort) return resolve(w.ort);
    const s = document.createElement("script");
    s.src = ORT_URL;
    s.crossOrigin = "anonymous";
    s.onload = () => resolve(w.ort!);
    s.onerror = () => reject(new Error("Could not load the image model runtime."));
    document.head.appendChild(s);
  })
    .then((ort) => {
      ort.env.wasm.wasmPaths = ORT_URL.replace(/ort\.min\.js$/, "");
      return ort.InferenceSession.create(MODEL_URL, { executionProviders: ["wasm"] });
    })
    .catch((e) => {
      session = null; // allow a retry
      throw e;
    });
  return session;
}

/** Probability (0-1) that the image is AI-generated, computed fully in this browser. */
export async function aiProbability(img: CanvasImageSource & { width: number; height: number }): Promise<number> {
  const sess = await loadSession();
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = CROP;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = "high";
  const { sx, sy, side } = cropBox(img.width, img.height);
  ctx.drawImage(img, sx, sy, side, side, 0, 0, CROP, CROP);
  const ort = (window as unknown as { ort: Ort }).ort;
  const input = new ort.Tensor("float32", toTensorData(ctx.getImageData(0, 0, CROP, CROP).data), [1, 3, CROP, CROP]);
  const out = await sess.run({ [sess.inputNames[0]]: input });
  return sigmoid(out[sess.outputNames[0]].data[0]);
}
