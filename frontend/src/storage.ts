import type { CreateLotPayload, Lot, Quote, Recycler } from "./types";

const DB_NAME = "kabadiwala-offline";
const DB_VERSION = 1;
type StoreName = "cache" | "queue" | "drafts";

export interface QueuedRequest {
  id: string;
  ownerId: string;
  path: string;
  body: unknown;
  createdAt: string;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("cache")) db.createObjectStore("cache");
      if (!db.objectStoreNames.contains("queue")) db.createObjectStore("queue", { keyPath: "id" });
      if (!db.objectStoreNames.contains("drafts")) db.createObjectStore("drafts", { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transaction<T>(store: StoreName, mode: IDBTransactionMode, action: (objectStore: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then((db) => new Promise<T>((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const request = action(tx.objectStore(store));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
    tx.onerror = () => { db.close(); reject(tx.error); };
  }));
}

export const saveCache = (key: string, value: unknown) => transaction("cache", "readwrite", (store) => store.put(value, key));
export const readCache = <T,>(key: string) => transaction<T | undefined>("cache", "readonly", (store) => store.get(key));
export const addQueuedRequest = (request: QueuedRequest) => transaction("queue", "readwrite", (store) => store.put(request));
export const removeQueuedRequest = (id: string) => transaction("queue", "readwrite", (store) => store.delete(id));
export const readQueue = (ownerId?: string) => {
  if (!ownerId) return Promise.resolve([] as QueuedRequest[]);
  return transaction<QueuedRequest[]>("queue", "readonly", (store) => store.getAll())
    .then((rows) => rows.filter((row) => row.ownerId === ownerId).sort((a, b) => a.createdAt.localeCompare(b.createdAt)));
};
export const saveDraft = (draft: Lot) => transaction("drafts", "readwrite", (store) => store.put(draft));
export const removeDraft = (id: string) => transaction("drafts", "readwrite", (store) => store.delete(id));
export const readDrafts = () => transaction<Lot[]>("drafts", "readonly", (store) => store.getAll());

export async function queueLot(payload: CreateLotPayload, quote: Quote, recycler: Recycler, ownerId: string): Promise<Lot> {
  const draft: Lot = {
    id: `offline-${payload.client_ref}`,
    lot_code: `PENDING-${payload.client_ref.slice(-8).toUpperCase()}`,
    collector_id: "offline",
    offline_owner_id: ownerId,
    collector_name: "",
    recycler_id: payload.recycler_id,
    recycler_name: recycler.organization,
    material: payload.material,
    weight_kg: payload.weight_kg,
    condition: payload.condition,
    description: payload.description,
    has_photo: Boolean(payload.image_data_url),
    photo_url: null,
    predicted_material: payload.predicted_material,
    prediction_confidence: payload.prediction_confidence,
    latitude: payload.latitude,
    longitude: payload.longitude,
    collection_mode: payload.collection_mode,
    scheduled_at: payload.scheduled_at,
    estimated_low: quote.estimated_low,
    estimated_high: quote.estimated_high,
    quoted_price: Math.round(recycler.offer_per_kg * payload.weight_kg * ({ excellent: 1, good: 0.88, fair: 0.7, poor: 0.48 }[payload.condition]) * 100) / 100,
    final_price: null,
    payment: null,
    status: "sync_pending",
    anomaly_flag: false,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    events: [],
  };
  await saveDraft(draft);
  await addQueuedRequest({ id: payload.client_ref, ownerId, path: "/api/lots", body: payload, createdAt: new Date().toISOString() });
  return draft;
}

export async function mergeDrafts(lots: Lot[], ownerId?: string): Promise<Lot[]> {
  if (!ownerId) return lots;
  const drafts = (await readDrafts()).filter((draft) => draft.offline_owner_id === ownerId);
  const serverRefs = new Set(lots.map((lot) => lot.id));
  return [...drafts.filter((draft) => !serverRefs.has(draft.id)), ...lots].sort((a, b) => b.created_at.localeCompare(a.created_at));
}
