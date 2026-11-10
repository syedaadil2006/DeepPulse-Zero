export type LivenessStatus =
  | "IDLE"
  | "NO_FACE"
  | "CALIBRATING"
  | "VERIFIED_HUMAN"
  | "DEEPFAKE_DETECTED";

export interface Landmark {
  x: number;
  y: number;
  z: number;
}

export interface Roi {
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Metrics {
  status: LivenessStatus;
  bpm: number | null;
  /** 0-100: share of cardiac-band energy concentrated in the dominant peak */
  pulseIndex: number;
  snrDb: number;
  fps: number;
  latencyMs: number;
  motion: number;
  bufferFill: number;
  waveform: number[];
  /** detected heartbeat times (ms, scanner clock) in the current window */
  beats: number[];
  /** colour direction of the pulse vs haemoglobin's (Blood Colour Fingerprint) */
  blood: { vec: [number, number, number]; angle: number; inPhase: boolean } | null;
  /** face-vs-neck pulse comparison; null when the neck is not visible or the buffer is short */
  neck: { faceBpm: number; neckBpm: number; corr: number; agree: boolean } | null;
}

/** One participant in a multi-person source (meeting mode). */
export interface FaceSummary {
  id: number;
  status: LivenessStatus;
  bpm: number | null;
  pulseIndex: number;
  neckSync: number | null;
}

export interface AlertEvent {
  id: string;
  sessionId: string;
  source: "live" | "simulated";
  status: LivenessStatus;
  bpm: number | null;
  pulseIndex: number;
  timestamp: number;
}

/** Continuous ~2 Hz vitals stream from a scanner (metadata only, never pixels). */
export interface Telemetry {
  kind: "telemetry";
  sessionId: string;
  source: "camera" | "upload" | "meeting";
  status: LivenessStatus;
  bpm: number | null;
  pulseIndex: number;
  fps: number;
  /** last ~4 s of the bandpassed pulse, downsampled, values in [-1, 1] */
  waveform: number[];
  timestamp: number;
}

export interface AuditEntry extends AlertEvent {
  prevHash: string;
  hash: string;
}
