export type Role = "collector" | "recycler" | "admin";
export type Language = "en" | "hi" | "mr";
export type Material = "mobile" | "laptop" | "tv" | "battery" | "printer" | "other";
export type Condition = "excellent" | "good" | "fair" | "poor";
export type LotStatus = "requested" | "accepted" | "scheduled" | "handed_over" | "paid" | "declined" | "sync_pending";

export interface User {
  id: string;
  name: string;
  email: string;
  phone?: string | null;
  role: Role;
  preferred_language: Language;
  created_at?: string;
}

export interface AuthResult {
  access_token: string;
  token_type: string;
  expires_at: string;
  user: User;
}

export interface RatePoint {
  date: string;
  rate_per_kg: number;
}

export interface Rate {
  material: Material;
  rate_per_kg: number;
  source: string;
  updated_at: string;
  history: RatePoint[];
  change_percent: number;
}

export interface Quote {
  material: Material;
  weight_kg: number;
  condition: Condition;
  market_rate_per_kg: number;
  condition_factor: number;
  estimated_rate_per_kg: number;
  estimated_low: number;
  estimated_expected: number;
  estimated_high: number;
  variation_percent: number;
  source: string;
  model_used: boolean;
  updated_at: string;
}

export interface Recycler {
  id: string;
  name: string;
  organization: string;
  email?: string;
  license_number: string;
  verified: boolean;
  address: string;
  latitude: number | null;
  longitude: number | null;
  materials: Material[];
  offer_per_kg: number;
  pickup_available: boolean;
  dropoff_available: boolean;
  distance_km: number | null;
  maps_url?: string | null;
}

export interface LotEvent {
  id: string;
  kind: string;
  note: string;
  details: Record<string, unknown>;
  created_at: string;
}

export interface Payment {
  amount: number;
  status: string;
  method: string;
  reference: string;
  updated_at: string;
}

export interface Lot {
  id: string;
  lot_code: string;
  collector_id: string;
  collector_name: string;
  recycler_id: string | null;
  recycler_name: string | null;
  material: Material;
  weight_kg: number;
  condition: Condition;
  description: string;
  has_photo: boolean;
  photo_url: string | null;
  predicted_material: Material | null;
  prediction_confidence: number | null;
  latitude: number | null;
  longitude: number | null;
  collection_mode: "pickup" | "dropoff";
  scheduled_at: string | null;
  estimated_low: number;
  estimated_high: number;
  quoted_price: number | null;
  final_price: number | null;
  payment: Payment | null;
  status: LotStatus;
  anomaly_flag: boolean;
  offline_owner_id?: string;
  created_at: string;
  updated_at: string;
  events: LotEvent[];
}

export interface CreateLotPayload {
  material: Material;
  weight_kg: number;
  condition: Condition;
  latitude: number | null;
  longitude: number | null;
  recycler_id: string;
  description: string;
  collection_mode: "pickup" | "dropoff";
  scheduled_at: string | null;
  image_data_url: string | null;
  predicted_material: Material | null;
  prediction_confidence: number | null;
  client_ref: string;
}

export interface DashboardData {
  totals: { lots: number; active: number; paid: number; weight_kg: number; earnings: number; anomalies: number; formal_handovers: number };
  recent_lots: Lot[];
  recycler_profile: { verified: boolean; organization: string } | null;
  online_seed_rates: number;
}

export interface ApiErrorShape {
  detail?: string | { msg?: string }[];
}
