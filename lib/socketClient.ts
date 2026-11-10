import type { AlertEvent, Telemetry } from "@/types";

async function post(body: AlertEvent | Telemetry): Promise<void> {
  try {
    await fetch("/api/socket", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      keepalive: true,
    });
  } catch {
    // relay offline: detection keeps working locally
  }
}

/** Sends a verdict change (metadata only, never pixels) to the alert relay. */
export const emitAlert = (alert: AlertEvent) => post(alert);

/** Sends the continuous vitals stream (metadata only, never pixels). */
export const emitTelemetry = (t: Telemetry) => post(t);

export function subscribeAlerts(
  onAlert: (a: AlertEvent) => void,
  onStatus?: (connected: boolean) => void,
  onTelemetry?: (t: Telemetry) => void,
): () => void {
  const es = new EventSource("/api/socket");
  es.onopen = () => onStatus?.(true);
  es.onerror = () => onStatus?.(false);
  es.onmessage = (e) => {
    try {
      onAlert(JSON.parse(e.data) as AlertEvent);
    } catch {
      /* ignore malformed frame */
    }
  };
  es.addEventListener("telemetry", (e) => {
    try {
      onTelemetry?.(JSON.parse((e as MessageEvent).data) as Telemetry);
    } catch {
      /* ignore malformed frame */
    }
  });
  return () => es.close();
}
