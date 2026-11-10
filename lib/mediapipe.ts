import type { Landmark, Roi } from "@/types";

// MediaPipe Tasks FaceLandmarker (same 478-point mesh as the legacy Face Mesh) on the GPU delegate:
// the legacy WASM build blocked the main thread for ~60-100 ms a frame, so the page itself stuttered.
const TASKS = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";
const MODEL = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";
// Legacy Face Mesh: slower, but the upload-mode blood-colour check was measured on its landmarks (EVALUATION.md);
// on the Tasks landmarker that check fell to chance level, so recorded videos keep this engine.
const LEGACY = "https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh@0.4.1633559619";

declare global {
  interface Window {
    FaceMesh?: new (cfg: { locateFile: (f: string) => string }) => FaceMeshInstance;
    FACEMESH_TESSELATION?: [number, number][];
  }
}

let legacyScript: Promise<void> | null = null;
let legacyFm: FaceMeshInstance | null = null;
let legacyQueue: Promise<void> = Promise.resolve();
async function createLegacy(maxNumFaces: number): Promise<FaceMeshInstance> {
  legacyScript ??= window.FaceMesh
    ? Promise.resolve()
    : new Promise<void>((resolve, reject) => {
        const el = document.createElement("script");
        el.src = `${LEGACY}/face_mesh.js`;
        el.crossOrigin = "anonymous";
        el.onload = () => resolve();
        el.onerror = () => {
          legacyScript = null;
          reject(new Error("Failed to load MediaPipe Face Mesh from CDN"));
        };
        document.head.appendChild(el);
      });
  await legacyScript;
  // one Face Mesh per page: closing it and building another in the same page hangs its WASM runtime
  legacyFm ??= new window.FaceMesh!({ locateFile: (file) => `${LEGACY}/${file}` });
  const fm = legacyFm;
  fm.setOptions({ maxNumFaces, refineLandmarks: true, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5 });
  edges = window.FACEMESH_TESSELATION ?? [];
  // one frame in flight at a time: a mode switch can start a new loop while the old one's frame is still running
  const send = (i: { image: HTMLVideoElement }) => {
    const r = legacyQueue.then(() => fm.send(i));
    legacyQueue = r.catch(() => {}); // a failed frame must not block every later one
    return r;
  };
  return { setOptions: (o) => fm.setOptions(o), onResults: (cb) => fm.onResults(cb), send, close: async () => {} };
}

export interface FaceMeshResults {
  image: CanvasImageSource;
  multiFaceLandmarks?: Landmark[][];
}

export interface FaceMeshInstance {
  setOptions(o: Record<string, unknown>): void;
  onResults(cb: (r: FaceMeshResults) => void): void;
  send(input: { image: HTMLVideoElement }): Promise<void>;
  close(): Promise<void>;
}

let edges: [number, number][] = [];

/** Loads the face landmarker (478 landmarks); `legacy` picks the original Face Mesh engine. Only the model files are downloaded; no frames are uploaded. */
export async function createFaceMesh(maxNumFaces = 1, legacy = false): Promise<FaceMeshInstance> {
  // shortcut: the two engines' WASM runtimes crash when both load in one page, so once an upload has loaded
  // Face Mesh the rest of the session stays on it (slower live mode until reload); fix by isolating one in a worker
  if (legacy || window.FaceMesh) return createLegacy(maxNumFaces);
  const url = `${TASKS}/vision_bundle.mjs`;
  const vision = await import(/* webpackIgnore: true */ url).catch(() => {
    throw new Error("Failed to load MediaPipe Face Landmarker from CDN");
  });
  const files = await vision.FilesetResolver.forVisionTasks(`${TASKS}/wasm`);
  const make = (delegate: "GPU" | "CPU") =>
    vision.FaceLandmarker.createFromOptions(files, {
      baseOptions: { modelAssetPath: MODEL, delegate },
      runningMode: "VIDEO",
      numFaces: maxNumFaces,
      minFaceDetectionConfidence: 0.5,
      minFacePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
  const lm = await make("GPU").catch(() => make("CPU")); // no usable WebGL (e.g. software GL in CI): CPU still works
  edges = vision.FaceLandmarker.FACE_LANDMARKS_TESSELATION.map((c: { start: number; end: number }) => [c.start, c.end]);
  let cb: ((r: FaceMeshResults) => void) | null = null;
  let last = 0;
  return {
    setOptions() {},
    onResults(f) {
      cb = f;
    },
    async send({ image }) {
      const t = Math.max(performance.now(), last + 1); // timestamps must strictly increase, even when upload mode seeks
      last = t;
      const r = lm.detectForVideo(image, t);
      cb?.({ image, multiFaceLandmarks: r.faceLandmarks });
    },
    async close() {
      lm.close();
    },
  };
}

export const tessellation = (): [number, number][] => edges;

// Spec landmark sets, plus one interior anchor each (151 mid-forehead, 50/280 cheek centers) so boxes have height.
export const FOREHEAD_IDX = [10, 338, 297, 67, 109, 151];
export const LEFT_CHEEK_IDX = [117, 118, 100, 50];
export const RIGHT_CHEEK_IDX = [346, 347, 329, 280];

function bbox(lm: Landmark[], idx: number[], w: number, h: number, label: string, shrinkX = 0): Roi {
  const xs = idx.map((i) => lm[i].x * w);
  const ys = idx.map((i) => lm[i].y * h);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const y0 = Math.min(...ys);
  const y1 = Math.max(...ys);
  const dx = (x1 - x0) * shrinkX;
  return { label, x: x0 + dx, y: y0, w: x1 - x0 - 2 * dx, h: Math.max(4, y1 - y0) };
}

/** Forehead + both cheek capillary ROIs in pixel space of a w×h frame. */
export function getRois(lm: Landmark[], w: number, h: number): Roi[] {
  return [
    bbox(lm, FOREHEAD_IDX, w, h, "FOREHEAD", 0.2),
    bbox(lm, LEFT_CHEEK_IDX, w, h, "CHEEK_L"),
    bbox(lm, RIGHT_CHEEK_IDX, w, h, "CHEEK_R"),
  ];
}

/** Mean landmark displacement between frames, in thousandths of frame size. */
export function landmarkMotion(prev: Landmark[] | null, cur: Landmark[]): number {
  if (!prev || prev.length !== cur.length) return 0;
  let s = 0;
  for (let i = 0; i < cur.length; i++) s += Math.hypot(cur[i].x - prev[i].x, cur[i].y - prev[i].y);
  return (s / cur.length) * 1000;
}

/** Neck skin just below the chin (null when out of frame). A pasted-on face does not cover it. */
export function getNeckRoi(lm: Landmark[], w: number, h: number): Roi | null {
  const chin = lm[152];
  const faceH = (chin.y - lm[10].y) * h;
  const jaw = Math.abs(lm[397].x - lm[172].x) * w;
  const y0 = chin.y * h + faceH * 0.12;
  const y1 = Math.min(h, chin.y * h + faceH * 0.42);
  if (y1 - y0 < 6 || jaw < 10) return null;
  return { label: "NECK", x: chin.x * w - jaw * 0.25, y: y0, w: jaw * 0.5, h: y1 - y0 };
}
