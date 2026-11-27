import type { AppConfig, ConditionsResponse, HealthResponse, HistoryResponse, MaintenanceResponse, OutlookResponse } from "../types";

export async function loadConfig(): Promise<AppConfig> {
  const res = await fetch("/config.json");
  if (!res.ok) throw new Error(`config.json: HTTP ${res.status}`);
  return (await res.json()) as AppConfig;
}

/** Typed client for the Keli Live API. `at` = null means live. */
export class Api {
  private readonly base: string;

  constructor(base: string) {
    this.base = base;
  }

  private async get<T>(path: string, signal?: AbortSignal): Promise<T> {
    const res = await fetch(this.base + path, { signal });
    if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
    return (await res.json()) as T;
  }

  conditions(at: Date | null, signal?: AbortSignal): Promise<ConditionsResponse> {
    return this.get(`/v1/conditions${at ? `?at=${encodeURIComponent(at.toISOString())}` : ""}`, signal);
  }

  history(cameraId: string, hours: number, at: Date | null, signal?: AbortSignal): Promise<HistoryResponse> {
    const q = new URLSearchParams({ hours: String(hours) });
    if (at) q.set("at", at.toISOString());
    return this.get(`/v1/cameras/${encodeURIComponent(cameraId)}/history?${q}`, signal);
  }

  outlook(cameraId: string, at: Date | null, signal?: AbortSignal): Promise<OutlookResponse> {
    const q = at ? `?at=${encodeURIComponent(at.toISOString())}` : "";
    return this.get(`/v1/cameras/${encodeURIComponent(cameraId)}/outlook${q}`, signal);
  }

  maintenance(hours: number, at: Date | null, signal?: AbortSignal): Promise<MaintenanceResponse> {
    const q = new URLSearchParams({ hours: String(hours) });
    if (at) q.set("at", at.toISOString());
    return this.get(`/v1/maintenance?${q}`, signal);
  }

  health(): Promise<HealthResponse> {
    return this.get("/v1/health");
  }
}
