import type {
  ApiErrorShape, AuthResult, CreateLotPayload, DashboardData, Lot, Material,
  Quote, Rate, Recycler, User,
} from "./types";
import { mergeDrafts, readCache, readQueue, removeDraft, removeQueuedRequest, saveCache } from "./storage";

const API_URL = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") ?? "";

export class ApiError extends Error {
  status: number;
  constructor(message: string, status = 0) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export function getToken() {
  return localStorage.getItem("kc-token");
}

function currentUserId(): string | null {
  try {
    return (JSON.parse(localStorage.getItem("kc-user") || "null") as User | null)?.id ?? null;
  } catch {
    return null;
  }
}

function cacheKey(path: string) {
  return `user:${currentUserId() ?? "guest"}:${path}`;
}

export function setSession(token: string, user: User) {
  localStorage.setItem("kc-token", token);
  localStorage.setItem("kc-user", JSON.stringify(user));
}

export function clearSession() {
  localStorage.removeItem("kc-token");
  localStorage.removeItem("kc-user");
}

function apiMessage(body: ApiErrorShape): string {
  if (typeof body.detail === "string") return body.detail;
  if (Array.isArray(body.detail) && body.detail[0]?.msg) return body.detail[0].msg;
  return "The request could not be completed. Please try again.";
}

async function request<T>(path: string, options: RequestInit = {}, cache = true): Promise<T> {
  const headers = new Headers(options.headers);
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (options.body && typeof options.body === "string") headers.set("Content-Type", "application/json");
  let response: Response;
  const key = cacheKey(path);
  try {
    response = await fetch(`${API_URL}${path}`, { ...options, headers });
  } catch {
    if (options.method === "GET" || !options.method) {
      const snapshot = await readCache<T>(key).catch(() => undefined);
      if (snapshot !== undefined) return snapshot;
    }
    throw new ApiError("Connection unavailable. Your saved work is still on this device.");
  }
  if (!response.ok) {
    let body: ApiErrorShape = {};
    try { body = await response.json() as ApiErrorShape; } catch { /* Empty or non-JSON server error. */ }
    throw new ApiError(apiMessage(body), response.status);
  }
  if (response.status === 204) return undefined as T;
  const data = await response.json() as T;
  if (cache && (!options.method || options.method === "GET")) await saveCache(key, data).catch(() => undefined);
  return data;
}

export const api = {
  login: (email: string, password: string) => request<AuthResult>("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }, false),
  register: (input: Record<string, unknown>) => request<AuthResult>("/api/auth/register", { method: "POST", body: JSON.stringify(input) }, false),
  me: () => request<User>("/api/auth/me", {}, false),
  logout: () => request<void>("/api/auth/logout", { method: "POST", body: "{}" }, false),
  updateLanguage: (preferred_language: string) => request<User>("/api/auth/preferences", { method: "PATCH", body: JSON.stringify({ preferred_language }) }, false),
  dashboard: () => request<DashboardData>("/api/dashboard"),
  prices: () => request<{ rates: Rate[]; currency: string; notice: string }>("/api/prices"),
  quote: (input: { material: Material; weight_kg: number; condition: string; latitude: number | null; longitude: number | null }) => request<Quote>("/api/prices/quote", { method: "POST", body: JSON.stringify(input) }, false),
  recyclers: (material: Material, latitude: number | null, longitude: number | null, mode?: string) => {
    const params = new URLSearchParams({ material });
    if (latitude !== null && longitude !== null) {
      params.set("latitude", String(latitude));
      params.set("longitude", String(longitude));
    }
    if (mode) params.set("collection_mode", mode);
    return request<{ recyclers: Recycler[] }>(`/api/recyclers?${params.toString()}`);
  },
  classify: (image_data_url: string) => request<{ material: Material | null; confidence: number; alternatives: { material: Material; confidence: number }[]; model: string; needs_confirmation: boolean }>("/api/ai/classify", { method: "POST", body: JSON.stringify({ image_data_url }) }, false),
  createLot: (input: CreateLotPayload) => request<Lot>("/api/lots", { method: "POST", body: JSON.stringify(input) }, false),
  lots: async (status?: string) => {
    const path = status ? `/api/lots?status=${encodeURIComponent(status)}` : "/api/lots";
    const result = await request<{ lots: Lot[] }>(path).catch(async (error: unknown) => {
      if (error instanceof ApiError && error.status === 0) return { lots: [] };
      throw error;
    });
    return { ...result, lots: await mergeDrafts(result.lots, currentUserId() ?? undefined) };
  },
  lot: (id: string) => request<Lot>(`/api/lots/${encodeURIComponent(id)}`),
  photo: async (url: string) => {
    const headers = new Headers();
    const token = getToken();
    if (token) headers.set("Authorization", `Bearer ${token}`);
    const response = await fetch(`${API_URL}${url}`, { headers });
    if (!response.ok) throw new ApiError("This photo could not be loaded.", response.status);
    return URL.createObjectURL(await response.blob());
  },
  acceptLot: (id: string) => request<Lot>(`/api/lots/${id}/accept`, { method: "POST", body: "{}" }, false),
  declineLot: (id: string) => request<Lot>(`/api/lots/${id}/reject`, { method: "POST", body: "{}" }, false),
  scheduleLot: (id: string, input: { collection_mode: "pickup" | "dropoff"; scheduled_at: string }) => request<Lot>(`/api/lots/${id}/schedule`, { method: "POST", body: JSON.stringify(input) }, false),
  handover: (id: string, input: { lot_code: string; confirmed_material: Material; note: string; idempotency_key: string }) => request<Lot>(`/api/lots/${id}/handover`, { method: "POST", body: JSON.stringify(input) }, false),
  payment: (id: string, input: { amount: number; method: string; reference: string; idempotency_key: string }) => request<{ lot: Lot; anomaly: { evaluated: boolean; flagged?: boolean; reason?: string } }>(`/api/lots/${id}/payment`, { method: "POST", body: JSON.stringify(input) }, false),
  recyclerProfile: () => request<{ user: User; profile: { organization: string; license_number: string; verified: boolean; latitude: number | null; longitude: number | null; address: string; materials: Material[]; offers: Record<string, number>; pickup_available: boolean; dropoff_available: boolean } }>("/api/recycler/profile", {}, false),
  updateRecyclerProfile: (input: Record<string, unknown>) => request<{ verified: boolean; profile: Record<string, unknown> }>("/api/recycler/profile", { method: "PUT", body: JSON.stringify(input) }, false),
  adminRecyclers: () => request<{ recyclers: Recycler[] }>("/api/admin/recyclers"),
  createRecycler: (input: Record<string, unknown>) => request("/api/admin/recyclers", { method: "POST", body: JSON.stringify(input) }, false),
  verifyRecycler: (id: string, verified: boolean, note: string) => request(`/api/admin/recyclers/${id}/verification`, { method: "PATCH", body: JSON.stringify({ verified, note }) }, false),
  publishRate: (input: { material: Material; rate_per_kg: number; source: string }) => request("/api/admin/prices", { method: "POST", body: JSON.stringify(input) }, false),
  analytics: () => request<{ lots_total: number; weight_total_kg: number; paid_total: number; recyclers_total: number; recyclers_verified: number; awaiting_review: number; by_material: { material: Material; lots: number; weight_kg: number; paid_value: number }[] }>("/api/admin/analytics"),
  feedback: () => request<{ samples: { id: string; lot_id: string; lot_code: string; material: Material; validation_state: string; reviewer_note: string; collector_name: string; recycler_name: string; created_at: string; photo_url: string }[] }>("/api/admin/feedback"),
  reviewFeedback: (id: string, validation_state: "validated" | "rejected", reviewer_note = "") => request(`/api/admin/feedback/${id}`, { method: "PATCH", body: JSON.stringify({ validation_state, reviewer_note }) }, false),
  anomalies: () => request<{ lots: Lot[] }>("/api/admin/anomalies"),
  flushQueue: async (): Promise<number> => {
    const token = getToken();
    if (!token || !navigator.onLine) return 0;
    const queue = await readQueue(currentUserId() ?? undefined);
    let sent = 0;
    for (const item of queue) {
      try {
        const response = await fetch(`${API_URL}${item.path}`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify(item.body),
        });
        if (!response.ok) break;
        await removeQueuedRequest(item.id);
        await removeDraft(`offline-${item.id}`);
        sent += 1;
      } catch {
        break;
      }
    }
    return sent;
  },
  cachedLots: () => readCache<{ lots: Lot[] }>(cacheKey("/api/lots")),
};

export async function downloadExport(path: string, filename: string) {
  const headers = new Headers();
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(`${API_URL}${path}`, { headers });
  if (!response.ok) {
    let detail = "Export failed.";
    try { detail = apiMessage(await response.json() as ApiErrorShape); } catch { /* Empty error body. */ }
    throw new ApiError(detail, response.status);
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
